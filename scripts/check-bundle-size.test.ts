import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { FAMILY_MODULES } from './bundle-fold.ts';
import { coreFiles, coreSize } from './check-bundle-size.ts';

function bundle(files: Record<string, string>) {
  const dist = mkdtempSync(join(tmpdir(), 'trillion3d-core-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  return dist;
}

/** Each family module's chunk, as esbuild names it: `trillion3d-<module>-<hash>.js`. */
const familyChunks = Object.values(FAMILY_MODULES).map(
  ([path], at) => `trillion3d-${basename(path, '.js')}-F${at}.js`,
);
const files = {
  'trillion3d.module.js':
    'import{a as b}from"./trillion3d-chunk-A.js";import"./side.js";' +
    'new URL("./physicsWorker.js",import.meta.url);' +
    familyChunks.map((chunk) => `()=>import("./${chunk}");`).join(''),
  'trillion3d-chunk-A.js': 'export{c as a}from"./deep.js";',
  'deep.js': 'export const c=1;',
  'side.js': '',
  ...Object.fromEntries(familyChunks.map((chunk) => [chunk, 'import"./trillion3d-chunk-A.js";'])),
};

test('the core is the entry and its static imports, never a chunk loaded on first use', () => {
  const dist = bundle(files);
  try {
    assert.deepEqual(coreFiles(dist), [
      'trillion3d.module.js',
      'trillion3d-chunk-A.js',
      'side.js',
      'deep.js',
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a core over its gzip budget fails the gate and says by how much it weighs', () => {
  const dist = bundle(files);
  try {
    const { bytes, fits, line } = coreSize(dist);
    assert.ok(fits);
    assert.match(line, /; physics, particles, transmission, deformation, effects, guides, /);
    const over = coreSize(dist, bytes - 1);
    assert.equal(over.fits, false);
    assert.match(over.line, new RegExp(`${bytes} bytes gzip in 4 files, OVER its budget`));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('each family module is a chunk of its own: one the core holds fails the gate by name', () => {
  // Particles imported statically, and physics folded in: no chunk of its own.
  const [physics, particles] = familyChunks;
  const rest = Object.entries(files).filter(([name]) => name !== physics);
  const entry = `import"./${particles}";${files['trillion3d.module.js']}`;
  const dist = bundle({ ...Object.fromEntries(rest), 'trillion3d.module.js': entry });
  try {
    const { fits, line } = coreSize(dist);
    assert.equal(fits, false);
    assert.match(line, /holds physics \(session\), particles \(particleCode\), to be loaded/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
