import type { ReactNode, RefObject } from 'react';
import type { AREAS } from '../../js/portal/routes.js';

export type Locale = 'en' | 'fr';

export type RouteArea = (typeof AREAS)[number];

export interface PortalRoute {
  locale: Locale;
  area: RouteArea;
  id: string;
}

type TranslateFn = (locale: Locale, key: string) => string;

export interface PortalEntryValue {
  name: string;
  desc: string;
}

/** One documented item, as the content files declare it (see `docsModel.js`). */
export interface PortalEntry {
  id: string;
  section: string;
  kind: string;
  description: string;
  title?: string;
  module?: string;
  signature?: string;
  exports?: string[];
  example?: string;
  html?: string;
  issue?: number;
  values?: PortalEntryValue[];
  valuesTitle?: string;
  replaces?: string;
  proof?: string;
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

export interface ApiIndexProps {
  locale: Locale;
  entries: PortalEntry[];
  t: TranslateFn;
}

export interface PrimaryNavigationProps {
  locale: Locale;
  activeArea?: RouteArea;
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
