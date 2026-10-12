import test from 'node:test'
import assert from 'node:assert/strict'
import { javascriptFiles } from './check-no-js.ts'

test('every JavaScript source anywhere in the repository is refused', () => {
  const files = [
    'packages/sdk-browser/src/index.ts',
    'bench/runner/bench.ts',
    'bench/runner/draw.js',
    'tests/kit/copy.mjs',
    'tests/fixtures/scenes/kinetic-garden/cache/native/full/manifest.json',
    'scripts/build-bundle.cjs',
    'engine.js',
  ]
  assert.deepEqual(javascriptFiles(files), [
    'bench/runner/draw.js',
    'tests/kit/copy.mjs',
    'scripts/build-bundle.cjs',
    'engine.js',
  ])
})

test('.ts and .mts sources pass', () => {
  const files = ['scripts/x.ts', 'packages/sdk-node/y.mts']
  assert.deepEqual(javascriptFiles(files), [])
})
