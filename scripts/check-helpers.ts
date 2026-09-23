// The small-helper check the block detector cannot do: a two-line `dot` copied into a second module
// stays under any block threshold. A free function of the same name, the same signature and the
// same body — comments and layout aside — defined in two non-test modules of one package or crate
// is a copy, reported with the module that should own it. The body is compared too: a driver's
// `convert` or a codec's `encode` share a name and a signature with their siblings by design and
// hold different code. `pnpm run check:helpers`; `scripts/check-helpers.test.ts` plants a copy.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';

/** Each package or crate is its own namespace: a helper is owned once per unit. */
export const UNITS = [
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec',
  'packages/asset-compiler-rust/src',
  'packages/page-codec-wasm/src',
];

export interface Helper {
  name: string;
  signature: string;
  body: string;
  file: string;
}

const TEST_TS = /\.(?:test|fixture|perf|browser)\.m?ts$/;
const TEST_RS = /(?:^|\/)(?:tests?|[\w]+_tests?)(?:\.rs$|\/)/;

/** Whether `file` is a test module, which may keep its own small copies. */
export const isTestModule = (file: string) =>
  file.endsWith('.rs') ? TEST_RS.test(file) : TEST_TS.test(file);

/** Parameter types only: names and defaults do not make two helpers different. */
function typesOf(params: string): string {
  let depth = 0,
    part = '';
  const parts: string[] = [];
  for (const ch of params) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else part += ch;
  }
  if (part.trim()) parts.push(part);
  return parts
    .map((p) => {
      const colon = p.indexOf(':');
      const type = colon === -1 ? '?' : p.slice(colon + 1).replace(/=.*$/s, '');
      return type.replace(/\s+/g, '');
    })
    .join(',');
}

/** The text from `start` to the brace that closes the one opened there, or, for an arrow's
 *  expression, to the end of its statement: comments and layout removed. */
function bodyAt(text: string, start: number): string {
  const block = text[start] === '{';
  let depth = 0,
    end = start;
  for (; end < text.length; end++) {
    const ch = text[end];
    if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth--;
    if (depth !== 0) continue;
    if (block ? ch === '}' : ch === ';' || (ch === '\n' && /\S/.test(text[end + 1] ?? ''))) break;
  }
  return text
    .slice(start, end + 1)
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '');
}

/** The helpers a TypeScript module defines at its top level. */
function tsHelpers(file: string, text: string): Helper[] {
  const out: Helper[] = [];
  const fn = /^(?:export )?function\s+(\w+)\s*(?:<[^>]*>)?\(([^)]*)\)\s*(?::\s*([^{\n]+))?\{/gm;
  const arrow = /^(?:export )?const\s+(\w+)\s*=\s*(?:<[^>]*>)?\(([^)]*)\)\s*(?::\s*([^=\n]+))?=>/gm;
  for (const re of [fn, arrow])
    for (const m of text.matchAll(re)) {
      const signature = `(${typesOf(m[2])})=>${(m[3] ?? '').replace(/\s+/g, '')}`;
      const at = m.index! + m[0].length;
      const open = re === fn ? at - 1 : at;
      out.push({ name: m[1], signature, body: bodyAt(text, open), file });
    }
  return out;
}

/** The free functions a Rust module defines outside its inline test modules; methods excluded. */
function rsHelpers(file: string, text: string): Helper[] {
  const out: Helper[] = [];
  const lines = text.split('\n');
  let offset = 0,
    skipDepth = -1,
    depth = 0,
    cfgTest = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (skipDepth === -1 && /^#\[cfg\(test\)\]/.test(trimmed)) cfgTest = true;
    else if (cfgTest && /^(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(trimmed)) {
      skipDepth = depth;
      cfgTest = false;
    } else if (trimmed && !trimmed.startsWith('#')) cfgTest = false;
    if (skipDepth === -1) {
      const m =
        /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\(([^)]*)\)\s*(?:->\s*([^{]+))?\{/.exec(
          line,
        );
      if (m && !/\bself\b/.test(m[2])) {
        const returns = (m[3] ?? '').replace(/\bwhere\b.*$/s, '').replace(/\s+/g, '');
        const body = bodyAt(text, offset + m[0].length - 1);
        out.push({ name: m[1], signature: `(${typesOf(m[2])})->${returns}`, body, file });
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (skipDepth !== -1 && depth <= skipDepth) skipDepth = -1;
    offset += line.length + 1;
  }
  return out;
}

/** Every helper of `files` (path -> text) defined twice, signature and body alike, in one unit. */
export function duplicateHelpers(files: Map<string, string>): Helper[][] {
  const seen = new Map<string, Helper[]>();
  for (const [file, text] of files) {
    const unit = UNITS.find((u) => file.startsWith(u + '/'));
    if (!unit || isTestModule(file.slice(unit.length))) continue;
    const helpers = file.endsWith('.rs') ? rsHelpers(file, text) : tsHelpers(file, text);
    for (const helper of helpers) {
      if (helper.name === 'main' || helper.name === 'default') continue;
      const key = `${unit}\0${helper.name}\0${helper.signature}\0${helper.body}`;
      seen.set(key, [...(seen.get(key) ?? []), helper]);
    }
  }
  return [...seen.values()].filter((group) => new Set(group.map((h) => h.file)).size > 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const tracked = repositoryFiles(root);
  if (!tracked) throw new Error('Not a Git repository.');
  const files = new Map(
    tracked
      .filter((file) => /\.(?:m?ts|rs)$/.test(file))
      .map((file): [string, string] => [file, readFileSync(join(root, file), 'utf8')]),
  );
  const groups = duplicateHelpers(files);
  for (const group of groups)
    console.error(
      `${group[0].name}${group[0].signature} is defined in ${group.map((h) => h.file).join(', ')}: ` +
        `keep it in ${group[0].file} and import it`,
    );
  if (groups.length) process.exitCode = 1;
  else console.log('No small helper is defined twice within one package.');
}
