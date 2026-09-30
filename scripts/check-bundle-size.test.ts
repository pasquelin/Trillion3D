import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreFiles, coreSize } from './check-bundle-size.ts';

function bundle(files: Record<string, string>) {
  const dist = mkdtempSync(join(tmpdir(), 'trillion3d-core-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  return dist;
}

const files = {
  'trillion3d.module.js':
    'import{a as b}from"./trillion3d-chunk-A.js";import"./side.js";' +
    'const s=()=>import("./trillion3d-session-B.js");new URL("./physicsWorker.js",import.meta.url);' +
    'const f=()=>import("./trillion3d-fluidCode-C.js");',
  'trillion3d-chunk-A.js': 'export{c as a}from"./deep.js";',
  'deep.js': 'export const c=1;',
  'side.js': '',
  'trillion3d-session-B.js': 'import"./trillion3d-chunk-A.js";'.repeat(200),
  'trillion3d-fluidCode-C.js': 'import"./trillion3d-chunk-A.js";',
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
    const { bytes, fits } = coreSize(dist);
    assert.ok(fits);
    const over = coreSize(dist, bytes - 1);
    assert.equal(over.fits, false);
    assert.match(over.line, new RegExp(`${bytes} bytes gzip in 4 files, OVER its budget`));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a family the core holds fails the gate by name, whatever its size (#1353)', () => {
  // The fluids imported statically, and the physics folded in: no chunk of its own.
  const rest = Object.entries(files).filter(([name]) => !name.includes('session'));
  const entry = `import"./trillion3d-fluidCode-C.js";${files['trillion3d.module.js']}`;
  const dist = bundle({ ...Object.fromEntries(rest), 'trillion3d.module.js': entry });
  try {
    const { fits, line } = coreSize(dist);
    assert.equal(fits, false);
    assert.match(line, /holds physics \(session\), fluids \(fluidCode\), to be loaded/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
