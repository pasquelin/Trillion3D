/**
 * The portal's shape: sections in sidebar order, the issues that entries still in development
 * point to, and the shape of an entry. Content files export arrays of entries; `app.js` groups
 * them by `section`, so the sidebar can never name a page that does not exist.
 *
 * Entry: `{ id, section, kind, title?, module?, signature?, description, values?, valuesTitle?,
 * example?, replaces?, proof?, issue?, html? }`. `kind` is `Function`, `Constant`, `Type` or
 * `Guide`; `issue` marks an entry the repository does not deliver yet — its page says so, with
 * the issue.
 */

/** One named/described item inside an entry's `values` list (e.g. an enum member). */
export interface PortalEntryValue {
  name: string;
  desc: string;
}

/** One documented item, as the content files declare it. */
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

export const SECTIONS = [
  { id: 'guides', title: 'Guides' },
  { id: 'examples', title: 'Examples' },
  { id: 'demo', title: 'Live demo' },
  { id: 'enums', title: 'Constants & enums' },
  { id: 'lifecycle', title: 'Engine lifecycle' },
  { id: 'camera', title: 'Camera & projection' },
  { id: 'host', title: 'Host camera & sides' },
  { id: 'matrices', title: 'Matrices' },
  { id: 'vectors', title: 'Vectors' },
  { id: 'colors', title: 'Colours' },
  { id: 'bounds', title: 'Boxes, spheres & frustums' },
  { id: 'tree', title: 'Transform tree' },
  { id: 'batches', title: 'Batch math' },
];

export const REPOSITORY = 'https://github.com/pasquelin/WebGeometry';

/** What each open issue delivers, as the badge of an entry in development says it. */
export const ISSUES: Record<number, string> = {
  79: 'Batch D — three-adapter and the migration guide',
};

export function issueUrl(issue: number) {
  return `${REPOSITORY}/issues/${issue}`;
}
