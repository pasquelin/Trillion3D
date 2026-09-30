import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fluidFiles, physicsFiles } from './installed-package-cdn.ts';

test('the physics of the CDN bundle is its worker, its modules and the chunk that starts them', () => {
  const chunks = [
    // The core names the worker's file in its build provenance, and starts nothing.
    { path: 'trillion3d.module.js', text: '{"sdk-browser/src/physics/physicsWorker.js":"a1"}' },
    { path: 'trillion3d-session-A.js', text: 'new Worker(b("physicsWorker",import.meta.url))' },
    { path: 'trillion3d-chunk-B.js', text: 'export const c=1;' },
    { path: 'physicsWorker.js', text: '' },
  ];
  const files = [...chunks.map(({ path }) => path), 'joltPhysics.wasm', 'joltPhysicsThreads.wasm'];
  assert.deepEqual(physicsFiles([...files, 'pageCodec.wasm'], chunks).sort(), [
    'joltPhysics.wasm',
    'joltPhysicsThreads.wasm',
    'physicsWorker.js',
    'trillion3d-session-A.js',
  ]);
});

test('the fluids of the CDN bundle are the chunk of their code, never a chunk it shares', () => {
  const dist = mkdtempSync(join(tmpdir(), 'trillion3d-cdn-'));
  try {
    // The core names the module in its build provenance, and fetches nothing.
    const names = ['trillion3d.module.js', 'trillion3d-chunk-A.js', 'trillion3d-session-B.js'];
    for (const name of [...names, 'trillion3d-fluidCode-C.js', 'trillion3d-fluidCode-C.js.map'])
      writeFileSync(join(dist, name), '"sdk-browser/src/fluids/fluidCode.js"');
    assert.deepEqual(fluidFiles(dist), ['trillion3d-fluidCode-C.js']);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
