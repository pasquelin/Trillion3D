// The portal may only name what the repository delivers: every entry without an `issue` badge
// must point at a file that exists and export the symbols its signature shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DOCS = join(ROOT, 'docs/js');

async function entries() {
  const files = readdirSync(DOCS).filter((name) => name.startsWith('docsContent'));
  const loaded = await Promise.all(files.map((name) => import(join(DOCS, name))));
  return loaded.flatMap((module) => Object.values(module).flat());
}

/** The identifiers a signature declares: `name(` or `name =`, one per documented symbol. */
function symbolsOf(signature) {
  return [...signature.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*(?:\(|=|:)/g)]
    .map((match) => match[1])
    .filter((name) => !['type', 'const', 'function', 'Promise', 'Record'].includes(name));
}

test('every delivered entry names a file that exists', async () => {
  for (const entry of await entries()) {
    if (!entry.module || entry.issue) continue;
    assert.ok(existsSync(join(ROOT, entry.module)), `${entry.id}: missing ${entry.module}`);
  }
});

test('every delivered signature names symbols that module exports', async () => {
  for (const entry of await entries()) {
    if (!entry.module || !entry.signature || entry.issue) continue;
    const source = readFileSync(join(ROOT, entry.module), 'utf8');
    const exported = new Set(
      [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|type|interface)\s+(\w+)/g)].map(
        (match) => match[1],
      ),
    );
    const found = symbolsOf(entry.signature).filter((name) => exported.has(name));
    assert.ok(found.length > 0, `${entry.id}: ${entry.module} exports none of its signature`);
  }
});

test('an entry in development names an open issue, and the sections are the declared ones', async () => {
  const { ISSUES, SECTIONS } = await import(join(DOCS, 'docsModel.js'));
  const sections = new Set(SECTIONS.map((section) => section.id));
  const ids = new Set();
  for (const entry of await entries()) {
    assert.ok(sections.has(entry.section), `${entry.id}: unknown section ${entry.section}`);
    assert.ok(!ids.has(entry.id), `duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    if (entry.issue) assert.ok(ISSUES[entry.issue], `${entry.id}: issue #${entry.issue} unlisted`);
  }
  assert.ok(ids.size > 40);
});
