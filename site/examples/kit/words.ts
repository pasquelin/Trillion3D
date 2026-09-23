/**
 * The examples' words, in the reader's language. One dictionary a language,
 * `examples/i18n/<code>.json` beside the example pages, English the reference: a `kit` part for
 * the kit's own words (menus, panel, counters) and one part an example, named by its file
 * (`a-field-of-pebbles.html` → `a-field-of-pebbles`), holding `controls`, `choices`, `readouts`,
 * `game` and free `words`. The language is `?lang=<code>` on the example's address (a portal
 * frame sets it; a sandbox sets it on its `<base>`), else the browser's, else English. A word
 * the dictionary lacks falls back on what the code gives: a humanised key, an identifier.
 */
export interface WordTree {
  [key: string]: string | WordTree;
}

/** Languages written right to left: their example documents mirror. */
const RIGHT_TO_LEFT = new Set(['ar', 'fa', 'he', 'ur']);

let tree: WordTree = {};
let code = 'en';

/** The language the words are in, a two-letter code such as `fr`. */
export const language = () => code;

/** The address the example was loaded from: its own, or its sandbox's `<base>`. */
const address = () => new URL(globalThis.document?.baseURI ?? 'about:blank');

/** The example's id: its file name, without `.html`. */
export const exampleId = (url: URL = address()) =>
  decodeURIComponent(url.pathname.split('/').pop() ?? '').replace(/\.html$/, '');

/** The language asked for: `?lang=` on `url`, else the first of `preferred` (the browser's),
 * reduced to its two letters. */
export function requestedLanguage(url: URL, preferred: readonly string[]): string {
  const asked = url.searchParams.get('lang') ?? preferred[0] ?? 'en';
  return asked.toLowerCase().split('-')[0] || 'en';
}

/** The word at `path`, or `undefined` when the dictionary has none there. */
export function lookup(path: readonly string[]): string | undefined {
  let node: string | WordTree | undefined = tree;
  for (const part of path) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}

/** `{name}` in `text` replaced by `values.name`. */
export const fill = (text: string, values: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );

/** `lightIntensity` → `Light intensity`: how a key reads when the dictionary has no word for it. */
export function labelOf(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The kit's own word at `kit.<group>.<key>`, else `fallback`: the key humanised by default. */
export const kitWord = (group: string, key: string, fallback = labelOf(key)) =>
  lookup(['kit', group, key]) ?? fallback;

/** The example's word at `<id>.<group>.<key>…`, else `fallback`: a label, a choice, a readout. */
export const exampleWord = (fallback: string, ...path: string[]) =>
  lookup([exampleId(), ...path]) ?? fallback;

/**
 * The free words of the example `id` (this page's by default): `say('score', { n: 3 })` reads
 * `<id>.words.score`, its `{n}` filled; a key the dictionary lacks reads as itself.
 */
export function words(id = exampleId()) {
  return (key: string, values?: Record<string, string | number>) =>
    fill(lookup([id, 'words', key]) ?? key, values);
}

/** Uses `dictionary` in the language `language`: what `loadWords` does once fetched. */
export function useWords(dictionary: WordTree, language: string) {
  tree = dictionary;
  code = language;
}

/** Reads the dictionary of the asked language, or English's when it has none. A dictionary that
 * cannot be read leaves every word on its fallback. */
async function fetchWords(asked: string): Promise<void> {
  for (const candidate of asked === 'en' ? ['en'] : [asked, 'en']) {
    const url = new URL(`../examples/i18n/${candidate}.json`, import.meta.url);
    const answer = await fetch(url).catch(() => null);
    if (answer?.ok) return useWords((await answer.json()) as WordTree, candidate);
  }
}

/**
 * Loads the page's words, then writes them: every element marked `data-words="<key>"` takes the
 * example's word of that key, and the document takes the language and its direction.
 */
export async function loadWords(doc: Document) {
  await fetchWords(requestedLanguage(address(), navigator.languages ?? [navigator.language]));
  const say = words();
  for (const element of doc.querySelectorAll<HTMLElement>('[data-words]'))
    element.textContent = say(element.dataset.words ?? '');
  doc.documentElement.lang = code;
  doc.documentElement.dir = RIGHT_TO_LEFT.has(code) ? 'rtl' : 'ltr';
}
