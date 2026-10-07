import test from 'node:test'
import assert from 'node:assert/strict'
import { changedSteps } from './changed-steps.ts'
import { goldenChecks } from './golden-checks.ts'

// Behaviour: the native step runs for a Rust source, the message catalogue the compiler embeds, and
// the golden values the crates' tests read; a TypeScript change alone leaves it out.
test('the native step follows the files the crates build from or read', () => {
  for (const file of [
    'packages/math/rust/src/aabb.rs',
    'packages/sdk-node/src/messages/messages.json',
    'packages/math/golden/quantize.json',
  ])
    assert.ok(changedSteps([file], [file], 0).includes('rust'), file)
  const typescript = 'packages/math/src/index.ts'
  assert.ok(!changedSteps([typescript], [typescript], 0).includes('rust'))
})

// Behaviour: a changed reference value runs the golden tests that read it — the crates whose
// `golden_twins` test names it and the TypeScript tests that assert it — and no other.
test('a changed reference value runs the golden tests that read it', () => {
  const file = 'packages/math/golden/grid.json'
  assert.ok(changedSteps([file], [file], 0).includes('golden'))
  const sources: Record<string, string> = {
    'packages/page-codec-wasm/src/golden_tests/grid.rs': 'Twin {\n    file: "grid",',
    'packages/math/rust/src/golden_tests.rs': 'Twin { file: "acos",',
    'packages/page-codec/src/gridExponent.golden.test.ts': "assertGolden('grid', 'tile_log2'",
    'packages/math/src/float/trig.golden.test.ts': "assertGolden('acos', 'acos'",
  }
  assert.deepEqual(
    goldenChecks([file], Object.keys(sources), (path) => sources[path]),
    {
      crates: ['packages/page-codec-wasm'],
      tests: ['packages/page-codec/src/gridExponent.golden.test.ts'],
    },
  )
  assert.deepEqual(goldenChecks(['packages/math/src/index.ts'], Object.keys(sources)), {
    crates: [],
    tests: [],
  })
})
