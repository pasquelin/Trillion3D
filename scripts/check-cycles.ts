// The import cycles that exist in the COMPILED JavaScript: modules that import each other's runtime
// values in a ring, so the order Node loads them in is not the order they were written in.
//
// It reads value edges only. An `import type { T } from './x.ts'` leaves no import behind in the
// emitted `.js` — `tsc` erases it — so it cannot make the load order matter, and a ring closed only
// by such an edge is not a ring. The tree holds 185 of those: two modules naming each other over a
// shared type. They are a real smell, and a question for another gate; here they would be noise.
//
// It reads a re-export as an edge, because `export { X } from './y.ts'` does force `./y.ts` to load.
// That is how a ring hides: a module imports a name from the module that re-exports it, and the one
// that defines it is somewhere else entirely. It is also how this detector found its first three.
//
// What it does not read, and why: a side-effect import (`import './x.ts'`, no `from`) is a load-order
// edge, and this does not count it — the tree has none today, and prettier keeps the form out. A
// dynamic `import()` is deferred, so it orders nothing at load time. A `require` cannot happen: the
// tree is ESM.
//
//   --baseline   read the rings to allow from `scripts/check-cycles-baseline.json`, a ratchet: the
//                five groups the tree holds today are named there, and a sixth fails. The file is
//                written by hand as groups are broken; `--write-baseline` prints the ones the tree
//                holds, for that shrinking, and a name the tree no longer has is reported too.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { sourceFilesOf } from './repository-files.ts';
import { normalized } from './check-calls-normalize.ts';
import { readBaseline, report } from './check-cycles-baseline.ts';

const EXTS = /\.m?ts$/;

/** The packages whose modules are read: the ones whose load order a session depends on. */
export const CYCLE_UNITS = [
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec',
] as const;

const TEST = /\.(?:test|fixture|perf|browser)\.m?ts$/;

const unitOf = (file: string) => CYCLE_UNITS.find((unit) => file.startsWith(unit + '/')) ?? null;

/** Whether an import clause binds a value the emitted JavaScript keeps. `import type { T }` binds
 *  none, and neither does a clause whose every binding is marked `type` — one real name beside them
 *  makes it a value edge. */
export function bindsValue(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) return false;
  if (/^\*\s+as\s/.test(trimmed)) return true; // `import * as ns` is a value; `import type * as ns` is not
  const braces = /\{([^}]*)\}/.exec(trimmed);
  if (!braces) return true; // a default or namespace binding
  return braces[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .some((name) => !/^type\s/.test(name));
}

/** Every module of `files` with the files it loads at evaluation time: a value import, or a
 *  re-export, which forces its target as surely as an import does. */
export function runtimeImportsOf(files: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of files.keys()) out.set(file, new Set());
  for (const [file, text] of files) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const add = (specifier: string) => {
      if (!specifier.startsWith('.')) return;
      const target = normalized(file, specifier);
      if (files.has(target)) out.get(file)!.add(target);
    };
    for (const statement of source.statements) {
      // A specifier is a string literal in every module of the tree; anything else is a computed
      // one, which names a file no reader can resolve ahead of time.
      const specifier =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : '';
      if (!specifier) continue;
      if (ts.isImportDeclaration(statement)) {
        // A dynamic `import()` is not a declaration statement, so it never reaches here: it is
        // deferred, and it orders nothing at load time.
        if (bindsValue(statement.importClause?.getText(source) ?? '')) add(specifier);
      } else {
        // `export { X } from './y.ts'` and `export * from './y.ts'` both force `./y.ts` to load, so
        // both are edges. Reading them is how a ring on a re-export is found at all.
        add(specifier);
      }
    }
  }
  return out;
}

/**
 * The groups of modules that reach each other, each with its members — a strongly connected
 * component, and the only shape worth reporting.
 *
 * Not the rings. A group of `n` mutually reachable modules holds exponentially many simple rings, and
 * the tree's largest group is 259 modules: enumerating rings took thirty minutes and named 190 of
 * them, all but eight of which the type rule had already removed. The component is the defect — the
 * load order inside it is whatever the bundler happened to emit — and there are five of them, which is
 * a number a person can hold.
 *
 * A module that reaches itself through a barrel is a component of one, and is reported.
 */
export function cyclesOf(imports: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let counter = 0;
  const visit = (file: string) => {
    index.set(file, counter);
    low.set(file, counter);
    counter++;
    stack.push(file);
    onStack.add(file);
    for (const next of imports.get(file) ?? []) {
      if (!imports.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(file, Math.min(low.get(file)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(file, Math.min(low.get(file)!, index.get(next)!));
      }
    }
    if (low.get(file) !== index.get(file)) return;
    const members: string[] = [];
    let last: string;
    do {
      last = stack.pop()!;
      onStack.delete(last);
      members.push(last);
    } while (last !== file);
    found.push(members.sort());
  };
  for (const file of imports.keys()) if (!index.has(file)) visit(file);
  return found.filter((members) => members.length > 1 || selfReaches(imports, members[0]));
}

/** Whether `file` reaches itself: a module that imports itself, directly or by a path. */
function selfReaches(imports: Map<string, Set<string>>, file: string): boolean {
  const seen = new Set<string>();
  const walk = (from: string): boolean => {
    for (const next of imports.get(from) ?? []) {
      if (next === file) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      if (walk(next)) return true;
    }
    return false;
  };
  return walk(file);
}

/** A group's name, canonical so a baseline lists it the same way every run whatever order the walk
 *  happened to pop the members in. */
export const ringKey = (ring: string[]): string => [...ring].sort().join(' -> ');

/** The rings to report: those the baseline does not name. An empty baseline reports every ring. */
export function newRings(rings: string[][], baseline: readonly string[]): string[][] {
  const known = new Set(baseline);
  return rings.filter((ring) => !known.has(ringKey(ring)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const files = sourceFilesOf(EXTS, root, (file) => !!unitOf(file) && !TEST.test(file));
  const rings = cyclesOf(runtimeImportsOf(files));

  if (process.argv.includes('--write-baseline')) {
    for (const key of [...new Set(rings.map(ringKey))].sort()) console.log(`  ${key}`);
    process.exitCode = 0;
  } else {
    const { fresh, stale, held } = report(rings, readBaseline(root));
    for (const ring of fresh)
      console.error(
        ring.length === 1
          ? `a module reaches itself: ${ring[0]}`
          : `${ring.length} modules reach each other: ${ring.join(', ')}`,
      );
    for (const key of stale)
      console.error(`the baseline names a group the tree no longer has: ${key}`);
    if (fresh.length || stale.length) {
      console.error(
        `${fresh.length} new group(s), ${stale.length} stale baseline entr(ies), of ${held} ` +
          `group(s) in ${files.size} maintained modules.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `No module of the ${files.size} maintained ones reaches another in a ring beyond the ` +
          `${held} the baseline names.`,
      );
    }
  }
}
