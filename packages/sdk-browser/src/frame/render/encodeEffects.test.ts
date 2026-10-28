// The effect chain on the WebGPU path: a held frame redisplays the image the chain drew and
// does no work of its own; a change of the chain breaks the hold, and so do programs compiling.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from '../loop/hold.ts'
import { drawFinalImage } from '../loop/hold.fixture.ts'
import { unsettledMask } from '../loop/unsettled.ts'
import { encodeEffects } from './encodeEffects.ts'
import { pendingWebgpuFrame } from '../loop/interactiveFrame.ts'
import { createExplorerFrameScheduler } from '../schedule/frameScheduler.ts'
import { frameQueue } from '../schedule/frameQueue.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import { createWebgpuEffects } from '../../post/effects/webgpuEffects.ts'
import { WEBGPU_KINDS } from '../../post/effects/webgpuKinds.ts'
import { KIND_RULES } from '../../post/effects/kindRules.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import { computePasses, drawing, encoder, framed, input, passes } from './encodeEffects.fixture.ts'
import { testKernel } from '../../post/effects/bloom/bloom.fixture.ts'
import { convolutionArriving } from '../../post/effects/bloom/convolution/convolutionPrograms.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { askEffectPrograms } from '../../post/effects/stagePlan.ts'

/** A complete frame encoding the chain. */
function drawImage(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  rt.run.gpuDrawCalls = 2 // what a frame counts from, before its passes
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
}

/** Two identical complete frames, each encoding the chain: what arms the hold. */
function armTwice(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  for (let i = 0; i < 2; i++) {
    drawImage(rt, device)
    rt.run.frame++
    keepWebgpuFrame(rt)
  }
}

/** The hold armed, then the establishment's final image, which encodes the chain too. */
function drawTwice(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  armTwice(rt, device)
  drawFinalImage(rt, device, () => drawImage(rt, device))
}

test('a held frame with a chain does no work; a change of the chain draws it again', async () => {
  const { device } = fakeDevice()
  const chain = new EffectChain(),
    bloom = effect.bloom()
  const rt = drawing(chain)
  chain.add(bloom)
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  await rt.gpu.effects!.settled()
  armTwice(rt, device)
  // The last bloom's glow is the composition's: it reads the image the levels read.
  const composed = encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  assert.equal(composed?.color, input.color, 'composition reads the image the chain read')
  // No as-is share rides with it: a debug view's as-is pixels are read from the surfaces at the
  // composition (it carried the share of the image it read).
  assert.ok(composed?.glow, "with the chain's glow")
  const lit = {} as GPUTextureView
  rt.gpu.hdrView = lit
  const still = encodeEffects(
    rt,
    device,
    encoder,
    undefined,
    framed(rt, device, lit),
    rt.gpu.targetSize,
  )
  assert.ok(still?.color === lit && still.glow, 'a still image too')
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

/** The render and compute passes one image of the chain draws. */
const drawnBy = (rt: ReturnType<typeof drawing>, device: GPUDevice) => {
  passes.length = computePasses.length = 0
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  return [passes.length, computePasses.length]
}

test('the view’s bloom settings and the effect’s dirt mask reach the passes, a setting breaks the hold', async () => {
  const { device } = fakeDevice()
  const bloom = effect.bloom()
  const rt = drawing(new EffectChain().add(bloom))
  drawnBy(rt, device)
  await rt.gpu.effects!.settled()
  const [all] = drawnBy(rt, device)
  drawTwice(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true, 'still: held')
  Object.assign(rt.context, { bloomQuality: 'lowest' }) // the three widest levels
  rt.gpu.kindSettings.peek('bloom', rt.context) // reading apart takes no change from the hold
  assert.equal(holdWebgpuFrame(rt, device), false, 'a quality written: the image is out of date')
  assert.ok(drawnBy(rt, device)[0] < all, 'fewer levels draw')
  Object.assign(rt.context, { bloomQuality: 'off' })
  assert.deepEqual(drawnBy(rt, device), [0, 0], 'off draws no bloom')
  Object.assign(rt.context, { bloomQuality: undefined })
  bloom.dirtMask = { image: { width: 8, height: 8 }, intensity: 1 }
  drawnBy(rt, device) // asks the programs the mask's levels need
  await pipelinesSettled(device)
  await rt.gpu.effects!.settled()
  assert.equal(drawnBy(rt, device)[0], all + 3, 'the three mip levels, no pass of its own')
  assert.equal(drawnBy(rt, device)[0], all, 'the picture is kept')
})

test('a convolution bloom reads the level as it is, an input only for another size, and keeps the kernel’s transform', async () => {
  const { device } = fakeDevice()
  const convolution = { kernel: testKernel() }
  const rt = drawing(new EffectChain().add(effect.bloom({ method: 'convolution', convolution })))
  drawnBy(rt, device)
  await rt.gpu.effects!.settled()
  // The transform's programs are asked ahead, for the sizes the view draws at; the image is drawn bare till then.
  askEffectPrograms(rt, device)
  assert.ok(convolutionArriving(device), 'asked before the first image that needs them')
  assert.equal(drawnBy(rt, device)[1], 0, 'no compute pass while the transform compiles')
  assert.equal(rt.gpu.effects!.loading, true)
  await rt.gpu.effects!.settled()
  const first = drawnBy(rt, device)
  assert.deepEqual(first, [1, 2], 'the half level alone: the kernel’s one pass, the transform’s')
  assert.deepEqual(drawnBy(rt, device), [first[0], 1], 'the kernel’s transform is kept')
  Object.assign(rt.context, { bloomCacheKernel: false })
  assert.deepEqual(drawnBy(rt, device), first, 'off, it is made again')
  Object.assign(rt.context, { bloomCacheKernel: true, bloomScreenPercentage: 35.355 })
  assert.equal(drawnBy(rt, device)[0], 2, 'a size the level is not: one pass brings it down')
})

test('compiling programs keep the frame from being held, the accumulation still', async () => {
  const { device } = fakeDevice()
  const chain = new EffectChain().add(effect.bloom())
  const rt = drawing(chain)
  const { revisions } = rt.run.gate,
    resources = revisions.resources
  armTwice(rt, device)
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
  WEBGPU_KINDS.bloom.create = (gpu, fail) =>
    new Promise((done) => (arrive = () => done(made(gpu, fail))))
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
      encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
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

// Per-kind dispatch (#349): a pass runs through the one table entry of its kind, with its rank among
// that kind's.

/** A kind that records what it is asked: sizes, and each pass with its rank. */
function spy() {
  const drawn: [Bloom, number][] = [],
    sized: number[][] = []
  const kind = {
    bytes: 0,
    resize: (w: number, h: number, count: number) => void sized.push([w, h, count]),
    dispose() {},
  }
  const draw = (pass: Bloom, nth: number) => (drawn.push([pass, nth]), 1)
  return {
    drawn,
    sized,
    webgpu: { ...kind, encode: (...args: unknown[]) => draw(args[1] as Bloom, args[2] as number) },
  }
}

test('the renderer has one implementation per kind, the kinds the budget reserves', () => {
  assert.deepEqual(Object.keys(WEBGPU_KINDS).sort(), Object.keys(KIND_RULES).sort())
})

test('the renderer hands each pass to its kind, with its rank among that kind', async (t) => {
  const kind = spy(),
    made = WEBGPU_KINDS.bloom.create,
    pair = [effect.bloom(), effect.bloom({ intensity: 0.5 })]
  t.after(() => void (WEBGPU_KINDS.bloom.create = made))
  WEBGPU_KINDS.bloom.create = async () => kind.webgpu
  const { device } = fakeDevice()
  const effects = createWebgpuEffects(device, (error) => assert.fail(String(error)))
  const commands = device.createCommandEncoder(),
    image = {} as GPUTextureView,
    post = {} as PostFrame
  effects.encode(commands, pair, image, 8, 4, post)
  await effects.settled()
  effects.encode(commands, pair, image, 8, 4, post)
  assert.deepEqual(kind.drawn, [
    [pair[0], 0],
    [pair[1], 1],
  ])
  assert.deepEqual(kind.sized.at(-1), [8, 4, 2])
})
