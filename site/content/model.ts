/**
 * The portal's shape: sections in sidebar order, the issues that entries still in development
 * point to, and the shape of an entry. Content files export arrays of entries; `app.js` groups
 * them by `section`, so the sidebar can never name a page that does not exist.
 *
 * An API entry reads in this order: `summary` (one line), `parameters`, `returns`, `example`,
 * `members`, then `description`, the longer text, when there is one. `kind` is `Function`,
 * `Constant`, `Type` or `Guide`; `issue` marks an entry the repository does not deliver yet — its
 * page says so, with the issue. `values` is a written entry's own table (the words of a union type).
 */

/** One named/described item inside an entry's `values` list (e.g. an enum member). */
export interface PortalEntryValue {
  name: string;
  desc: string;
}

/** One parameter of a function; a field of an options object reads `options.field`. */
export interface PortalParameter {
  name: string;
  type: string;
  /** The value taken when the caller gives none, as source text. */
  default?: string;
  desc: string;
}

/** What a function gives back. */
interface PortalReturn {
  type: string;
  desc: string;
}

/** One member of an object or a type: a field and its type, or a method and what it returns. */
export interface PortalMember {
  name: string;
  type: string;
  desc: string;
}

/** One documented item, as the content files declare it. */
export interface PortalEntry {
  id: string;
  section: string;
  kind: string;
  description: string;
  summary?: string;
  title?: string;
  module?: string;
  signature?: string;
  exports?: string[];
  parameters?: PortalParameter[];
  returns?: PortalReturn;
  members?: PortalMember[];
  example?: string;
  html?: string;
  issue?: number;
  values?: PortalEntryValue[];
  valuesTitle?: string;
  replaces?: string;
  proof?: string;
}

/** What a written page adds to a generated entry, by its id: a longer text, an example, the
 *  table of the words of a union type, the witness a function replaces and the proof. */
export type EntryNote = Pick<PortalEntry, 'id'> &
  Partial<Pick<PortalEntry, 'description' | 'example' | 'values' | 'replaces' | 'proof'>>;

/** The families that describe a scene, in the order a page meets them. */
const SCENE_FAMILIES = [
  'geometry',
  'material',
  'light',
  'camera',
  'object',
  'math',
  'texture',
  'loader',
  'helper',
  'animation',
  'buffer',
];
/** The constant families: one named value per word, gathered under "Constants". */
const CONSTANT_FAMILIES = ['blending', 'side', 'wrap', 'filter', 'colorSpace', 'toneMapping'];
/** The families that reach the engine's machinery: pages, budgets, measurement. */
const ENGINE_FAMILIES = [
  'page',
  'budget',
  'metric',
  'diagnostic',
  'capability',
  'capture',
  'pose',
  'batch',
];
/** Every family a page writes with, in reference order. */
export const FAMILIES = [...SCENE_FAMILIES, ...CONSTANT_FAMILIES, ...ENGINE_FAMILIES];

/** The sections of the portal, in sidebar order: the course, the guides and how it works, then the reference — the world and
 *  its families first, the constants gathered in one section, then the low-level maths, the Node
 *  compiler and every other public type. */
export const SECTIONS = [
  { id: 'course', title: 'Course' },
  { id: 'guides', title: 'Guides' },
  { id: 'internals', title: 'How it works' },
  { id: 'world', title: 'World' },
  ...SCENE_FAMILIES.map((id) => ({ id, title: id })),
  { id: 'constants', title: 'Constants' },
  ...ENGINE_FAMILIES.map((id) => ({ id, title: id })),
  { id: 'math-utilities', title: 'Math utilities' },
  { id: 'node', title: 'Node and compilation' },
  { id: 'types', title: 'Types and errors' },
];

/** The one-line summary of an entry, the line an index shows under its name: its `summary`, or
 *  the first sentence of its description. */
export function entrySummary(entry: Pick<PortalEntry, 'description' | 'summary'>): string {
  if (entry.summary) return entry.summary;
  const text = entry.description.trim();
  return (/^.+?[.!?](?=\s+[A-Z`(]|$)/s.exec(text)?.[0] ?? text).trim();
}

const REPOSITORY = 'https://github.com/pasquelin/WebGeometry';

/** What each open issue delivers, as the badge of an entry in development says it. */
export const ISSUES: Record<number, string> = {};

export function issueUrl(issue: number) {
  return `${REPOSITORY}/issues/${issue}`;
}
