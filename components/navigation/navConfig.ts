import type { ComponentType } from 'react';
import {
  Users,
  LayoutDashboard,
  Settings,
  User,
  MoreHorizontal,
  Kanban
} from 'lucide-react';

export type PrimaryNavId = 'inbox' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  /** Route to navigate. For "more", this is omitted because it opens a menu/sheet. */
  href?: string;
  icon: ComponentType<{ className?: string }>;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'boards', label: 'Boards', href: '/boards', icon: Kanban },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

export type SecondaryNavId = 'dashboard' | 'reports' | 'settings' | 'profile';

export interface SecondaryNavItem {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

/** Mirrors non-primary destinations available in the desktop sidebar/user menu. */
export const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visão Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'settings', label: 'Configurações', href: '/settings', icon: Settings },
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
];
