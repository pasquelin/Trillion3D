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
    'const s=()=>import("./trillion3d-session-B.js");new URL("./physicsWorker.js",import.meta.url);',
  'trillion3d-chunk-A.js': 'export{c as a}from"./deep.js";',
  'deep.js': 'export const c=1;',
  'side.js': '',
  'trillion3d-session-B.js': 'import"./trillion3d-chunk-A.js";'.repeat(200),
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
