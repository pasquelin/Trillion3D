// The effect chain on the WebGPU path: a held frame redisplays the image the chain drew and
// does no work of its own; a change of the chain breaks the hold, and so do programs compiling.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../../sdk-core/src/world/effect/index.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from '../../frame/hold.ts'
import { unsettledMask } from '../../frame/unsettled.ts'
import { encodeEffects } from './encodeEffects.ts'
import { pendingWebgpuFrame } from '../../frame/interactiveFrame.ts'
import { createExplorerFrameScheduler } from '../../../world/render/frameScheduler.ts'
import { frameQueue } from '../../../world/render/frameQueue.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { WEBGPU_KINDS } from '../../effects/webgpuKinds.ts'
import { drawing, encoder, input, passes } from './encodeEffects.fixture.ts'

/** Two identical complete frames, each encoding the chain: what arms the hold. */
function drawTwice(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  for (let i = 0; i < 2; i++) {
    rt.run.gpuDrawCalls = 2 // what a frame counts from, before its passes
    encodeEffects(rt, device, encoder, input)
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
}

test('a held frame with a chain does no work; a change of the chain draws it again', async () => {
  const { device } = fakeDevice()
  const chain = new EffectChain(),
    bloom = effect.bloom()
  const rt = drawing(chain)
  chain.add(bloom)
  encodeEffects(rt, device, encoder, input)
  await rt.gpu.effects!.settled()
  drawTwice(rt, device)
  // The last bloom's blend is the composition's: it reads the image the levels read.
  const composed = encodeEffects(rt, device, encoder, input)
  assert.equal(composed?.color, input.color, 'composition reads the image the chain read')
  assert.ok(composed?.bloom, "with the chain's blend")
  assert.equal(composed?.share, input.share, 'with the as-is share of the image it read')
  const lit = {} as GPUTextureView
  rt.gpu.hdrView = lit
  const still = encodeEffects(rt, device, encoder, undefined)
  assert.ok(still?.color === lit && still.bloom && still.share === undefined, 'a still image too')
  drawTwice(rt, device)
  const drawn = passes.length
  assert.ok(drawn > 0, 'the full frames drew the bloom')
  assert.equal(holdWebgpuFrame(rt, device), true, 'still: the image the chain drew is redisplayed')
  assert.equal(holdWebgpuFrame(rt, device), true)
  assert.equal(passes.length, drawn, 'held frames draw no pass of the chain')
  bloom.intensity = 0.3
  assert.equal(holdWebgpuFrame(rt, device), false, 'a setting changed: the image is out of date')
  assert.equal(rt.run.frameHeld, false)
  assert.equal(unsettledMask(rt), 0, 'the chain runs after the resolve: accumulation stays still')
})

test('compiling programs keep the frame from being held, the accumulation still', async () => {
  const { device } = fakeDevice()
  const chain = new EffectChain().add(effect.bloom())
  const rt = drawing(chain)
  const { revisions } = rt.run.gate,
    resources = revisions.resources
  drawTwice(rt, device)
  assert.equal(rt.gpu.effects!.loading, true)
  assert.equal(unsettledMask(rt), 0, 'compiling moves nothing the accumulation reads')
  assert.equal(holdWebgpuFrame(rt, device), false, 'the image lacks the chain it will have')
  await rt.gpu.effects!.settled()
  assert.equal(revisions.resources, resources, 'the arrival restarts no accumulation')
  assert.equal(holdWebgpuFrame(rt, device), false, 'the image drawn while compiling is redrawn')
  drawTwice(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true, 'drawn with the chain, the image is held')
})

test('an idle loop waits for the programs, then draws the image with the chain once', async (t) => {
  const { device } = fakeDevice()
  const made = WEBGPU_KINDS.bloom.create
  t.after(() => void (WEBGPU_KINDS.bloom.create = made))
  let arrive = () => {}
  WEBGPU_KINDS.bloom.create = (gpu) => new Promise((done) => (arrive = () => done(made(gpu))))
  const chain = new EffectChain().add(effect.bloom())
  const rt = drawing(chain)
  const turn = () => new Promise((resolve) => setImmediate(resolve))
  const requested = frameQueue()
  const scheduler = createExplorerFrameScheduler({
    request: requested.request,
    cancel: requested.cancel,
    // `renderWebgpuPages` reduced to its two outcomes: the frame held, or encoded and kept.
    render() {
      if (holdWebgpuFrame(rt, device)) return
      rt.run.gpuDrawCalls = 2
      encodeEffects(rt, device, encoder, input)
      rt.run.frame++
      keepWebgpuFrame(rt)
    },
    pending: () => pendingWebgpuFrame(rt),
    error: (error) => assert.fail(String(error)),
  })
  scheduler.invalidate()
  requested.run()
  // The frame asked right after is drawn while the first one's feedback waits for the programs;
  // the next comes with both feedbacks in flight: drawn too, the display paces the loop, and it
  // asks no feedback.
  requested.run()
  requested.run()
  for (let i = 0; i < 4; i++) await turn()
  assert.equal(rt.gpu.effects!.loading, true)
  assert.equal(requested.size, 1, 'the loop keeps its pace while they compile')
  assert.notEqual(rt.gpu.effectsRevision, chain.revision, 'the image lacks the chain meanwhile')
  arrive()
  while (rt.gpu.effects!.loading) await turn()
  await turn()
  assert.equal(requested.size, 1, 'their arrival asks the image with the chain')
  requested.run()
  assert.equal(rt.gpu.effectsRevision, chain.revision, 'the image carries the chain')
})
