/**
 * The portal's shape: sections in sidebar order, the issues that entries still in development
 * point to, and the shape of an entry. Content files export arrays of entries; `app.js` groups
 * them by `section`, so the sidebar can never name a page that does not exist.
 *
 * Entry: `{ id, section, kind, title?, module?, signature?, description, values?, example?,
 * replaces?, proof?, issue?, html? }`. `kind` is `Function`, `Constant`, `Type` or `Guide`;
 * `issue` marks an entry the repository does not deliver yet — its page says so, with the issue.
 */
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
export const ISSUES = {
  60: 'Targeted subtree update',
  79: 'Batch D — three-adapter and the migration guide',
  80: 'Batch math API for hosts',
};

export function issueUrl(issue) {
  return `${REPOSITORY}/issues/${issue}`;
}

/** Text the sidebar filter matches: title, signature, description and module path. */
export function searchText(entry) {
  return [entry.title || entry.id, entry.signature, entry.description, entry.module]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
