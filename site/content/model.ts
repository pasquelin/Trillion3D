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
interface PortalEntryValue {
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

/** A step of the course's way through: where it goes, what kind of step it is, the page it names. */
interface CourseLink {
  href: string;
  caption: string;
  title?: string;
}

/** A course chapter's page, in one language: the example it builds, its steps and code, what to
 *  try, the chapters around it, and the headings they sit under. `steps` and `tryIt` are HTML;
 *  the first chapter has no `previous`, the last one's `next` is the examples. */
export interface CourseChapter {
  example: string;
  steps: string[];
  code: string[];
  tryIt: string;
  previous?: CourseLink;
  next: CourseLink;
  words: { steps: string; code: string; tryIt: string; open: string; navigation: string };
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
  chapter?: CourseChapter;
}

/** What a written page adds to a generated entry, by its id: an example, the names of the words
 *  of a union type, the witness a function replaces and the proof. Its text — a longer
 *  description, what each word means — is in each language's dictionary, under `written`. */
export type EntryNote = Pick<PortalEntry, 'id'> &
  Partial<Pick<PortalEntry, 'example' | 'replaces' | 'proof'>> & { valueNames?: string[] };

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
  'controls',
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

/** The sections of the portal, in sidebar order: the course, the guides and how it works, then the
 *  reference — the world and its families first, the constants gathered in one section, then the
 *  low-level maths, the Node compiler and every other public type. A family section is titled by
 *  the family's own name; the others by `section.<id>` in each language's dictionary. */
export const SECTIONS = [
  'course',
  'guides',
  'internals',
  'world',
  ...SCENE_FAMILIES,
  'constants',
  ...ENGINE_FAMILIES,
  'math-utilities',
  'node',
  'types',
];

/** The one-line summary of an entry, the line an index shows under its name: its `summary`, or
 *  the first sentence of its description. */
export function entrySummary(entry: Pick<PortalEntry, 'description' | 'summary'>): string {
  if (entry.summary) return entry.summary;
  const text = entry.description.trim();
  return (/^.+?[.!?](?=\s+[A-Z`(]|$)/s.exec(text)?.[0] ?? text).trim();
}

/** The description past the summary: the rest of it when the summary is its first sentence, all
 *  of it when the summary is a line of its own. */
export function entryRest(entry: Pick<PortalEntry, 'description' | 'summary'>): string {
  const summary = entrySummary(entry);
  const { description } = entry;
  return (description.startsWith(summary) ? description.slice(summary.length) : description).trim();
}

const REPOSITORY = 'https://github.com/pasquelin/WebGeometry';

/** What each open issue delivers, as the badge of an entry in development says it. */
export const ISSUES: Record<number, string> = {};

export function issueUrl(issue: number) {
  return `${REPOSITORY}/issues/${issue}`;
}
