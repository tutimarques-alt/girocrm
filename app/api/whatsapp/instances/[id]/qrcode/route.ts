import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getInstance } from '@/lib/supabase/whatsapp';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

type Params = { params: Promise<{ id: string }> };

/** Get QR code for WhatsApp connection */
export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { id } = await params;
  const instance = await getInstance(supabase, id);
  if (!instance || instance.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const creds = await getEvolutionCredentials(supabase, instance);
    const result = await evolution.connectInstance(creds);

        const raw = result.base64 || result.code || '';
    const value = raw.replace(/^data:image\/[^;]+;base64,/, '');

    return NextResponse.json({
      data: {
        value,
        connected: false,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível obter o QR Code. Verifique se a instância está ativa na Evolution API.' },
      { status: 502 },
    );
  }
}
