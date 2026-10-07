import test from 'node:test'
import assert from 'node:assert/strict'
import { changedSteps } from './changed-steps.ts'

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
