// A frame's feedback asks its GPU waits as the frame is submitted: it answers for that frame's
// work and reads, never for a frame the loop draws while it is in flight.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pendingWebgpuFrame } from './interactiveFrame.ts'
import { settledRt } from './hold.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

installGpuGlobals()

/** Waits the test settles by hand, one per call, in the order they were asked. */
function gates() {
  const open: (() => void)[] = []
  return {
    open,
    ask: () => new Promise<void>((done) => open.push(done)),
  }
}

/** A settled engine whose queue, cut readbacks and texture feedback each answer when the test says. */
function engine() {
  const rt = settledRt(),
    work = gates(),
    reads = gates(),
    textures = gates()
  Object.assign(rt.gpu, { device: { queue: { onSubmittedWorkDone: work.ask } } })
  Object.assign(rt.run, { gpuSelection: { flush: async () => (await reads.ask(), null) } })
  Object.assign(rt.vis, { textures: { settled: textures.ask } })
  return { rt, work, reads, textures }
}

test('each frame asks its GPU work, cut reads and texture feedback at its submit', async () => {
  const { rt, work, reads, textures } = engine()
  const first = pendingWebgpuFrame(rt)
  assert.equal(work.open.length, 1, 'the queue is asked before the call returns')
  assert.equal(reads.open.length, 1, 'the cut reads too')
  assert.equal(textures.open.length, 1, 'and the texture feedback')
  // The next frame is drawn and submitted while the first is in flight.
  const second = pendingWebgpuFrame(rt)
  for (const wait of [work, reads, textures]) wait.open[0]()
  assert.equal(await first, true, "the first frame's feedback lands on its own work alone")
  for (const wait of [work, reads, textures]) wait.open[1]()
  assert.equal(await second, true)
})

test('a held frame asks the GPU nothing', async () => {
  const { rt, work } = engine()
  rt.run.frameHeld = true
  assert.equal(await pendingWebgpuFrame(rt), false)
  assert.equal(work.open.length, 0)
})
