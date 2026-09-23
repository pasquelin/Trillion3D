// The portal may only name what the repository delivers: every entry that is not marked as
// carried by an open issue declares the symbols it documents, and each must be exported by the
// file it names (the reference's signatures are read from the declarations themselves). An
// entry that is marked must name an issue the portal lists. Every demo must belong to an entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { ISSUES, SECTIONS } from '../../site/content/model.ts';
import type { PortalEntry } from '../../site/content/model.ts';
import { DEMOS } from '../../site/demos/registry.ts';
import { entriesIn } from '../../site/app/portal/data.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const ENTRIES: PortalEntry[] = entriesIn('en');

/** Names a file declares or re-exports, read once per file from its syntax tree. */
const exportsOf = new Map<string, Set<string>>();
function exported(module: string): Set<string> {
  const known = exportsOf.get(module);
  if (known) return known;
  const file = join(ROOT, module);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    const exporting =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exporting) continue;
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    const named = (statement as { name?: ts.Node }).name;
    if (named && ts.isIdentifier(named)) names.add(named.text);
  }
  exportsOf.set(module, names);
  return names;
}

test('every delivered entry names a file that exists', () => {
  for (const entry of ENTRIES) {
    if (!entry.module || entry.issue) continue;
    assert.ok(existsSync(join(ROOT, entry.module)), `${entry.id}: missing ${entry.module}`);
  }
});

test('every symbol a delivered entry documents is exported by the file it names', () => {
  for (const entry of ENTRIES) {
    if (entry.issue) continue;
    if (!entry.exports) {
      assert.ok(!entry.module, `${entry.id}: names a module without declaring its symbols`);
      continue;
    }
    assert.ok(entry.exports.length > 0, `${entry.id}: an empty symbol list checks nothing`);
    assert.ok(entry.module, `${entry.id}: exports without a module`);
    const names = exported(entry.module);
    for (const symbol of entry.exports)
      assert.ok(names.has(symbol), `${entry.id}: ${entry.module} does not export ${symbol}`);
  }
});

/** What a package entry point really exports: its own declarations and what it re-exports. */
const surfaces = new Map<string, Set<string>>();
function surfaceOf(file: string, seen: Set<string> = new Set()): Set<string> {
  const cached = surfaces.get(file);
  if (cached) return cached;
  const names = new Set<string>();
  if (seen.has(file) || !existsSync(join(ROOT, file))) return names;
  seen.add(file);
  const source = readFileSync(join(ROOT, file), 'utf8');
  for (const name of exported(file)) names.add(name);
  const directory = file.slice(0, file.lastIndexOf('/'));
  for (const match of source.matchAll(/export\s+\*\s+from\s+'([^']+)'/g))
    for (const name of surfaceOf(resolveFrom(directory, match[1]), seen)) names.add(name);
  surfaces.set(file, names);
  return names;
}

/** A relative import of the sources, `./x.ts` or `../pkg/x.ts`, as a repository path. */
function resolveFrom(directory: string, specifier: string): string {
  const parts = `${directory}/${specifier}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

const ENTRY_POINTS: Record<string, string[]> = {
  trillion3d: ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'],
};

function exampleModule(specifier: string): string[] | null {
  return ENTRY_POINTS[specifier] ?? null;
}

test('an example only imports what the file or entry point it names really exports', () => {
  for (const entry of ENTRIES) {
    if (entry.issue || !entry.example) continue;
    for (const match of entry.example.matchAll(/import\s+\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
      const files = exampleModule(match[2]);
      assert.ok(files, `${entry.id}: unsupported public import: ${match[2]}`);
      for (const file of files)
        assert.ok(existsSync(join(ROOT, file)), `${entry.id}: ${file} does not exist`);
      const surface = new Set(files.flatMap((file) => [...surfaceOf(file)]));
      for (const name of match[1]
        .split(',')
        .map(
          (part) =>
            part
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0],
        )
        .filter(Boolean))
        assert.ok(surface.has(name), `${entry.id}: ${match[2]} does not export ${name}`);
    }
  }
});

test('examples cannot treat arbitrary implementation files as public modules', () => {
  assert.equal(exampleModule('packages/sdk-core/src/index.ts'), null);
  assert.equal(exampleModule('packages/sdk-browser/src/world/session/explorer.ts'), null);
});

test('every demo belongs to an entry of the portal', () => {
  const ids = new Set(ENTRIES.map((entry) => entry.id));
  for (const id of Object.keys(DEMOS)) assert.ok(ids.has(id), `demo ${id} has no entry`);
});

test('an entry in development names a listed issue, and every section is filled', () => {
  const sections = new Set(SECTIONS);
  const filled = new Set();
  const ids = new Set();
  for (const entry of ENTRIES) {
    assert.ok(sections.has(entry.section), `${entry.id}: unknown section ${entry.section}`);
    assert.ok(!ids.has(entry.id), `duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    filled.add(entry.section);
    if (entry.issue) assert.ok(ISSUES[entry.issue], `${entry.id}: issue #${entry.issue} unlisted`);
  }
  // The live demo is the one section the router fills, not a content file.
  for (const section of sections) assert.ok(filled.has(section) || section === 'demo', section);
});
