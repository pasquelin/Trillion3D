import type { AREAS } from '../../js/portal/routes.js';

export type Locale = 'en' | 'fr';

export type RouteArea = (typeof AREAS)[number];

export interface PortalRoute {
  locale: Locale;
  area: RouteArea;
  id: string;
}

export type TranslateFn = (locale: Locale, key: string) => string;

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
