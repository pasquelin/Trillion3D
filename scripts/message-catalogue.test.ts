import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogueMessages, messageOf } from '../packages/sdk-node/src/messages/catalogue.mts';
import { stalePages } from './message-pages.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUST = join(ROOT, 'packages/asset-compiler-rust/src');
const NODE = join(ROOT, 'packages/sdk-node/src');
/** Code-shaped literals of the compiler that name something else: attributes, variables, tags. */
const NOT_MESSAGES = new Set([
  'CARGO_PKG_VERSION',
  'COLOR_0',
  'JOINTS_0',
  'JOLT_COMMIT',
  'OUT_DIR',
  'RAM_MB',
  'TEXCOORD_0',
  'TEXCOORD_1',
  'TRILLION3D_CACHE_LOCK_WAIT_MS',
  'WEIGHTS_0',
  'alembic-ogawa-1-gltf-3',
  'hdr-radiance-rgbe-1',
  'image-plugin-3',
  'ma-mel-subset-1-gltf-8',
  'ma-root',
  'material-library',
  'psd-composite-aplati-3',
  'texture-candidate',
  'usd-double-sided',
  'usd-root',
]);
/** The families of the compiler's report codes, by their first word. */
const FAMILIES =
  'alembic|autonomous|blend|bmp|dds|eac|exr|hdr|image|ktx2|light|ma|material|node|psd|texture|unity|usd';
const CODE_LITERAL = new RegExp(
  `"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|CANCELLED|(?:${FAMILIES})-[a-z0-9-]+)(?=[":])`,
  'g',
);

function files(directory: string, keep: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : files(path, keep);
    return keep(path) ? [path] : [];
  });
}
/** A Rust file's own code: its inline test module, always last, is left out. */
const withoutTests = (text: string) => text.split(/#\[cfg\(test\)\]\s*mod tests\s*\{/)[0];
const isRustSource = (path: string) => path.endsWith('.rs') && !/(^|[/_])tests?[_.]/.test(path);
const isNodeSource = (path: string) => path.endsWith('.mts');

// Behaviour: every code the compiler can write — an error, a report reason, a DAG warning — is in
// the catalogue; a new code-shaped literal is either catalogued or named here as something else.
test('every code emitted by the Rust sources is in the catalogue', () => {
  const missing = new Set<string>();
  for (const path of files(RUST, isRustSource))
    for (const [, code] of withoutTests(readFileSync(path, 'utf8')).matchAll(CODE_LITERAL))
      if (!NOT_MESSAGES.has(code) && !messageOf(code))
        missing.add(`${code} (${relative(ROOT, path)})`);
  assert.deepEqual([...missing], []);
});

// Behaviour: the Node adapter raises no bare error: each one goes through `compilerError` with a
// catalogued name, so every message it gives carries its public code.
test('every code emitted by the Node adapter is in the catalogue', () => {
  const named = /(?:compilerError|describeMessage|messageOf)\(\s*'([^']+)'/g;
  const problems: string[] = [];
  for (const path of files(NODE, isNodeSource)) {
    const text = readFileSync(path, 'utf8');
    const where = relative(ROOT, path);
    if (/\bnew (?:Type)?Error\(/.test(text)) problems.push(`bare error in ${where}`);
    for (const [, code] of text.matchAll(named))
      if (!messageOf(code)) problems.push(`${code} (${where})`);
  }
  assert.deepEqual(problems, []);
});

// Behaviour: ids are unique and say their level, every entry has one sentence, a cause and an
// action, and every code has its documentation page, current with the catalogue.
test('every catalogue code is well formed and has its documentation page', () => {
  const letter = { error: 'E', warn: 'W', info: 'I' } as const;
  assert.equal(new Set(catalogueMessages.map((m) => m.id)).size, catalogueMessages.length);
  assert.equal(new Set(catalogueMessages.map((m) => m.code)).size, catalogueMessages.length);
  for (const entry of catalogueMessages) {
    assert.match(entry.id, new RegExp(`^T3D-${letter[entry.level]}\\d{3}$`), entry.code);
    assert.match(entry.message, /^[A-Z].*\.$/, entry.code);
    assert.doesNotMatch(entry.message, /\. [A-Z]/, `${entry.code}: one sentence`);
    assert.ok(entry.cause && entry.action, entry.code);
  }
  assert.deepEqual(stalePages(ROOT), []);
});
