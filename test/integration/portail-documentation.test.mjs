// The portal may only name what the repository delivers: every entry that is not marked as
// carried by an open issue declares the symbols it documents, each must be exported by the file
// it names, and a documented signature must take the arguments the function really takes. An
// entry that is marked must name an issue the portal lists. Every demo must belong to an entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const CONTENT = join(ROOT, 'site/content');

const modules = await Promise.all(
  readdirSync(join(CONTENT, 'entries')).map((name) => import(join(CONTENT, 'entries', name))),
);
const ENTRIES = modules.flatMap((module) => Object.values(module).flat());
const { ISSUES, SECTIONS } = await import(join(CONTENT, 'model.ts'));

/** Names a file declares or re-exports, read once per file. */
const exportsOf = new Map();
function exported(module) {
  const known = exportsOf.get(module);
  if (known) return known;
  const source = readFileSync(join(ROOT, module), 'utf8');
  const names = new Set([
    ...[
      ...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/g),
    ].map((match) => match[1]),
    ...[...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((match) =>
      match[1].split(',').map((name) =>
        name
          .trim()
          .split(/\s+as\s+|\s+/)
          .pop(),
      ),
    ),
  ]);
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
    const names = exported(entry.module);
    for (const symbol of entry.exports)
      assert.ok(names.has(symbol), `${entry.id}: ${entry.module} does not export ${symbol}`);
  }
});

/** The parameters a `name(a, b, c)` line of a signature declares, in order. */
function signatureArguments(signature, name) {
  const match = new RegExp(`\\b${name}\\s*(?:<[^>]*>)?\\s*\\(([^)]*)\\)`).exec(signature);
  if (!match) return null;
  const inside = match[1].trim();
  return inside === '' ? [] : inside.split(',').map((argument) => argument.trim());
}

test('a documented signature takes the arguments the function really takes', async () => {
  const engine = await import(join(ROOT, 'site/demos/engine.ts'));
  for (const entry of ENTRIES) {
    if (entry.issue || !entry.signature || !entry.exports) continue;
    for (const symbol of entry.exports) {
      const shown = signatureArguments(entry.signature, symbol);
      const real = engine[symbol];
      if (shown === null || typeof real !== 'function') continue;
      const optional = shown.filter((argument) => argument.includes('=') || argument.includes('?'));
      assert.ok(
        shown.length >= real.length && shown.length - optional.length <= real.length,
        `${entry.id}: ${symbol} shows ${shown.length} arguments, the engine takes ${real.length}`,
      );
    }
  }
});

/** What a package entry point really exports: its own declarations and what it re-exports. */
const surfaces = new Map();
function surfaceOf(file, seen = new Set()) {
  const cached = surfaces.get(file);
  if (cached) return cached;
  const names = new Set();
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
function resolveFrom(directory, specifier) {
  const parts = `${directory}/${specifier}`.split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

const ENTRY_POINTS = {
  'web-geometry': ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'],
};

function exampleModule(specifier) {
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
  assert.equal(exampleModule('packages/sdk-core/index.ts'), null);
  assert.equal(exampleModule('packages/sdk-browser/explorer.ts'), null);
});

test('every demo belongs to an entry of the portal', async () => {
  const { DEMOS } = await import(join(ROOT, 'site/demos/registry.ts'));
  const ids = new Set(ENTRIES.map((entry) => entry.id));
  for (const id of Object.keys(DEMOS)) assert.ok(ids.has(id), `demo ${id} has no entry`);
});

test('an entry in development names a listed issue, and every section is filled', () => {
  const sections = new Set(SECTIONS.map((section) => section.id));
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
