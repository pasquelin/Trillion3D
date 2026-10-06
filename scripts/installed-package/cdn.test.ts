import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { familyFiles, physicsFiles } from './cdn.ts'

test('the physics of the CDN bundle is its worker, its modules and the chunk that starts them', () => {
  const chunks = [
    // The core names the worker's file in its build provenance, and starts nothing.
    { path: 'trillion3d.module.js', text: '{"sdk-browser/src/physics/physicsWorker.js":"a1"}' },
    { path: 'trillion3d-session-A.js', text: 'new Worker(b("physicsWorker",import.meta.url))' },
    { path: 'trillion3d-chunk-B.js', text: 'export const c=1;' },
    { path: 'physicsWorker.js', text: '' },
  ]
  const files = [...chunks.map(({ path }) => path), 'joltPhysics.wasm', 'joltPhysicsThreads.wasm']
  assert.deepEqual(physicsFiles([...files, 'pageCodec.wasm'], chunks).sort(), [
    'joltPhysics.wasm',
    'joltPhysicsThreads.wasm',
    'physicsWorker.js',
    'trillion3d-session-A.js',
  ])
})

test('each other family of the CDN bundle is the chunk of its code, never a chunk it shares', () => {
  const dist = mkdtempSync(join(tmpdir(), 'trillion3d-cdn-'))
  try {
    // The core names a module in its build provenance, and fetches nothing.
    const names = ['trillion3d.module.js', 'trillion3d-chunk-A.js', 'trillion3d-session-B.js']
    const chunks = ['trillion3d-particleCode-C.js', 'trillion3d-guideCode-D.js']
    for (const name of [...names, ...chunks, 'trillion3d-guideCode-D.js.map'])
      writeFileSync(join(dist, name), '"sdk-browser/src/guides/guideCode.js"')
    const found = familyFiles(dist).filter(({ files }) => files.length)
    assert.deepEqual(found, [
      { family: 'particles', files: ['trillion3d-particleCode-C.js'] },
      { family: 'guides', files: ['trillion3d-guideCode-D.js'] },
    ])
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})
