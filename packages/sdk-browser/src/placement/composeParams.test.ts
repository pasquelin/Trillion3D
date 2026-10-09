// The roots pass's parameters follow the cut's ranges by their numbers: nothing of a cut replaced
// is kept by the composition, and a frame under the same ranges sends no parameter. On a generated
// session of two composed roots and a cut swapped under it.
import test from 'node:test'
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { session, turn } from './composeSession.fixture.ts'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

test('a cut swapped out is let go by the composition; still ranges send no parameter', async () => {
  const { rt, rows, frame, writes } = session()
  composeWebgpuPlacements(
    rt,
    {},
    turn(0),
    [0, 1].map((index) => ({ rows, index, local: turn(0) })),
    true,
  )
  frame()
  const params = () => writes.filter((write) => write.size === 64 * 4).length
  const sent = params()
  frame()
  assert.equal(params(), sent, 'the same ranges: no parameter sent')
  // The cut swapped: its ranges let go, the new one's as the old's.
  const old = new WeakRef(rt.run.gpuSelection!.worldRanges)
  rt.run.gpuSelection = {
    ...rt.run.gpuSelection!,
    worldRanges: rt.run.gpuSelection!.worldRanges.map((range) => ({ ...range })),
  }
  for (let k = 0; k < 2; k++) {
    gc()
    await new Promise((settle) => setImmediate(settle))
  }
  assert.equal(old.deref(), undefined, 'the old cut’s ranges are not kept')
})
