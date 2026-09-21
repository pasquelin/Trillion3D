import type { ReactNode, RefObject } from 'react';

export type Locale = 'en' | 'fr';

export type RouteArea = 'learn' | 'examples' | 'playground' | 'api' | 'reports';

export interface RouteTarget {
  locale: Locale;
  area: RouteArea | string;
  id?: string;
}

export interface PortalRoute {
  locale: Locale;
  area: RouteArea | string;
  id: string;
}

type TranslateFn = (locale: Locale, key: string) => string;

export interface PortalEntryValue {
  name: string;
  desc: string;
}

export interface PortalEntry {
  id: string;
  kind?: string;
  title?: string;
  section?: string;
  module?: string;
  signature?: string;
  description?: string;
  guide?: string;
  example?: string;
  issue?: number;
  exports?: string[];
  html?: string;
  values?: PortalEntryValue[];
  valuesTitle?: string;
  replaces?: string;
  proof?: string;
  [key: string]: unknown;
}

export interface EntryLinkItem {
  entry: PortalEntry;
  key: string;
  id: string;
  label: string;
  primary: boolean;
}

export type ResolvedPage =
  | { kind: 'report' }
  | { kind: 'home' }
  | { kind: 'entry'; entry: PortalEntry }
  | { kind: 'gallery' }
  | { kind: 'engine-scene' }
  | { kind: 'playground'; id: string }
  | { kind: 'api-index' }
  | { kind: 'not-found' };

export interface SectionItem {
  id: string;
  title: string;
}

export interface ApiIndexProps {
  locale: Locale;
  entries: PortalEntry[];
  t: TranslateFn;
}

export interface PrimaryNavigationProps {
  locale: Locale;
  activeArea?: string;
  t: TranslateFn;
  mobile?: boolean;
  onNavigate?: () => void;
}

export interface HeaderProps {
  locale: Locale;
  route: PortalRoute;
  t: TranslateFn;
  drawerOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onTheme: () => void;
}

export interface HomeProps {
  locale: Locale;
  t: TranslateFn;
}

export interface LayoutProps {
  children: ReactNode;
  entries: PortalEntry[];
  route: PortalRoute;
  localeRoute?: PortalRoute;
  query: string;
  t: TranslateFn;
  drawerOpen: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onMenu: () => void;
  onClose: () => void;
  onSearch: () => void;
  onQuery: (query: string) => void;
  onTheme: () => void;
}

export interface NotFoundProps {
  locale: Locale;
}

export interface SidebarProps {
  entries: PortalEntry[];
  route: PortalRoute;
  query: string;
  t: TranslateFn;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onClose: () => void;
}

export interface EntryProps {
  entry: PortalEntry;
  locale?: Locale;
}
