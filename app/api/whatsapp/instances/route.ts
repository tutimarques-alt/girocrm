import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getInstances } from '@/lib/supabase/whatsapp';
import { getEvolutionGlobalConfig, generateInstanceName } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

const CreateInstanceSchema = z.object({
  name: z.string().min(1).max(100),
});

async function getUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) };
  }

  return {
    ok: true as const,
    supabase,
    userId: user.id,
    organizationId: profile.organization_id,
    role: profile.role,
  };
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx.ok) return ctx.response;

  try {
    const instances = await getInstances(ctx.supabase, ctx.organizationId);
    return NextResponse.json({ data: instances });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const isTableMissing = msg.includes('whatsapp_instances') || msg.includes('relation') || msg.includes('42P01');
    if (isTableMissing) {
      return NextResponse.json(
        { error: 'Tabelas do WhatsApp não encontradas. Execute a migration do Supabase.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await getUserContext();
  if (!ctx.ok) return ctx.response;
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CreateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const { name } = parsed.data;

  let baseUrl: string;
  let globalApiKey: string;
  try {
    ({ baseUrl, globalApiKey } = await getEvolutionGlobalConfig(ctx.supabase, ctx.organizationId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Evolution API não configurada.' },
      { status: 400 },
    );
  }

  const instanceName = generateInstanceName(ctx.organizationId, name);

  const { data: dbInstance, error: dbError } = await ctx.supabase
    .from('whatsapp_instances')
    .insert({
      organization_id: ctx.organizationId,
      name,
      instance_id: instanceName,
      instance_token: 'pending',
      evolution_instance_name: instanceName,
      status: 'disconnected',
    })
    .select()
    .single();

  if (dbError || !dbInstance) {
    return NextResponse.json(
      { error: dbError?.message || 'Falha ao criar registro no banco de dados.' },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const webhookUrl = appUrl ? `${appUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/${dbInstance.id}` : undefined;

  let evoResult: evolution.CreateInstanceResponse;
  try {
    evoResult = await evolution.createInstance(baseUrl, globalApiKey, {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: false,
      rejectCall: true,
      msgCall: 'Não posso atender ligações no momento. Por favor, envie uma mensagem.',
      groupsIgnore: true,
      alwaysOnline: true,
      readMessages: true,
      readStatus: true,
      syncFullHistory: true,
      ...(webhookUrl
        ? {
            webhook: {
              url: webhookUrl,
              webhookByEvents: false,
              webhookBase64: true,
              events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
            },
          }
        : {}),
    });
  } catch (err) {
    console.error('[whatsapp] Failed to create Evolution API instance:', err);
    await ctx.supabase.from('whatsapp_instances').delete().eq('id', dbInstance.id);
    return NextResponse.json({ error: 'Falha ao criar instância na Evolution API.' }, { status: 502 });
  }

  let instanceToken =
  (typeof evoResult.hash === 'string' ? evoResult.hash : evoResult.hash?.apikey) ||
  (evoResult as unknown as { instance?: { apikey?: string } })?.instance?.apikey ||
  (evoResult as unknown as { token?: string })?.token ||
  '';

if (!instanceToken) {
  try {
    const instances = await evolution.fetchInstances(baseUrl, globalApiKey, instanceName);
    const inst = instances[0] as unknown as {
      instance?: { apikey?: string };
      apikey?: string;
      hash?: { apikey?: string };
    };
    instanceToken =
      inst?.instance?.apikey ||
      inst?.apikey ||
      inst?.hash?.apikey ||
      '';
  } catch (err) {
    console.error('[whatsapp] Failed to fetch instance token via fetchInstances:', err);
  }
}

if (!instanceToken) {
  console.error('[whatsapp] Could not get instance token. Response:', JSON.stringify(evoResult));
  instanceToken = 'pending';
}
  const { data: updatedInstance } = await ctx.supabase
    .from('whatsapp_instances')
    .update({
      instance_id: evoResult.instance.instanceId,
      instance_token: instanceToken,
      webhook_url: webhookUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dbInstance.id)
    .select()
    .single();

  const instanceCreds: evolution.EvolutionCredentials = {
    baseUrl,
    apiKey: instanceToken,
    instanceName,
  };

  await evolution
    .setWebSocket(instanceCreds, {
      enabled: true,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
    })
    .catch((err) => console.error('[whatsapp] Failed to configure WebSocket:', err));

  return NextResponse.json({ data: updatedInstance ?? dbInstance }, { status: 201 });
}
