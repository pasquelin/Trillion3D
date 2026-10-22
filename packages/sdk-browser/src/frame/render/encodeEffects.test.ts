// The effect chain on the WebGPU path: a held frame redisplays the image the chain drew and
// does no work of its own; a change of the chain breaks the hold, and so do programs compiling.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { holdWebgpuFrame, keepWebgpuFrame } from '../loop/hold.ts'
import { unsettledMask } from '../loop/unsettled.ts'
import { encodeEffects } from './encodeEffects.ts'
import { pendingWebgpuFrame } from '../loop/interactiveFrame.ts'
import { createExplorerFrameScheduler } from '../schedule/frameScheduler.ts'
import { frameQueue } from '../schedule/frameQueue.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import { createWebgpuEffects } from '../../post/effects/webgpuEffects.ts'
import { WEBGPU_KINDS } from '../../post/effects/webgpuKinds.ts'
import { EFFECT_KIND_BYTES } from '../../post/effects/kindBytes.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import { computePasses, drawing, encoder, framed, input, passes } from './encodeEffects.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { FFT_PARAMS, fftShader } from '../../post/effects/bloom/convolution/fftWgsl.ts'
import {
  analyseKernel,
  applyConstants,
  NORMALISED_BY,
} from '../../post/effects/bloom/convolution/kernelStats.ts'
import { defaultBloomKernel } from '../../post/effects/bloom/convolution/defaultKernel.ts'
import { planConvolution } from '../../post/effects/bloom/convolution/plan.ts'
import {
  channelScale,
  transformShape,
  writeTransformWords,
} from '../../post/effects/bloom/convolution/transformShape.ts'
import { twiddleTable } from '../../post/effects/bloom/convolution/twiddles.ts'

/** Two identical complete frames, each encoding the chain: what arms the hold. */
function drawTwice(rt: ReturnType<typeof drawing>, device: GPUDevice) {
  for (let i = 0; i < 2; i++) {
    rt.run.gpuDrawCalls = 2 // what a frame counts from, before its passes
    encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
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
  encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  await rt.gpu.effects!.settled()
  drawTwice(rt, device)
  // The last bloom's glow is the composition's: it reads the image the levels read.
  const composed = encodeEffects(rt, device, encoder, input, framed(rt, device), rt.gpu.displaySize)
  assert.equal(composed?.color, input.color, 'composition reads the image the chain read')
  assert.ok(composed?.glow, "with the chain's glow")
  assert.equal(composed?.share, input.share, 'with the as-is share of the image it read')
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
  assert.ok(still?.color === lit && still.glow && still.share === undefined, 'a still image too')
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
  assert.equal(holdWebgpuFrame(rt, device), false, 'a quality written: the image is out of date')
  assert.ok(drawnBy(rt, device)[0] < all, 'fewer levels draw')
  Object.assign(rt.context, { bloomQuality: 'off' })
  assert.deepEqual(drawnBy(rt, device), [0, 0], 'off draws no bloom')
  Object.assign(rt.context, { bloomQuality: undefined })
  bloom.dirtMask = { image: { width: 8, height: 8 }, intensity: 1 }
  assert.equal(drawnBy(rt, device)[0], all + 1 + 3, 'the finishing, and three mip levels')
  assert.equal(drawnBy(rt, device)[0], all + 1, 'the picture is kept: the finishing alone')
  bloom.dirtMask = { intensity: 0 }
  assert.equal(drawnBy(rt, device)[0], all, 'an intensity of 0 draws no dirt')
})

test('a convolution bloom draws its input and three passes of the transform, the kernel once', async () => {
  const { device } = fakeDevice()
  const rt = drawing(new EffectChain().add(effect.bloom({ method: 'convolution' })))
  drawnBy(rt, device)
  await rt.gpu.effects!.settled()
  const first = drawnBy(rt, device)
  assert.ok(first[0] >= 1 && first[1] > 3, 'the input, the kernel and the three of the transform')
  assert.deepEqual(drawnBy(rt, device), [first[0], 3], 'the kernel’s transform is kept')
  Object.assign(rt.context, { bloomCacheKernel: false })
  assert.deepEqual(drawnBy(rt, device), first, 'off, it is made again')
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
  assert.deepEqual(Object.keys(WEBGPU_KINDS).sort(), Object.keys(EFFECT_KIND_BYTES).sort())
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

test('the convolution plan and the kernel’s reading follow the reference’s numbers', () => {
  const limits = { side: 16384, maxLine: 4096, bytes: 2 ** 31 }
  const at = (percent: number, view = [1920, 1080]) =>
    planConvolution({ view, percent, size: 1, bufferScale: 0.133 }, limits)
  const [full, half, tenth] = [at(100), at(35.355), at(12.5)]
  assert.deepEqual(
    [full.image, full.frequency, full.horizontalFirst],
    [[1920, 1080], [2048, 2048], true],
  )
  assert.deepEqual(
    [full.level, half.level, half.image, at(25).level, tenth.level],
    [-1, 0, [679, 382], 1, 2],
  )
  const stats = analyseKernel(defaultBloomKernel(), 1920, 1)
  const spread = stats.scatterEnergy[0] / (stats.centreEnergy[0] + stats.scatterEnergy[0])
  assert.ok(stats.centre[0] === 256 && spread > 0.08 && spread < 0.2, 'about an eighth spreads')
  const { sceneTint, multiply } = applyConstants(stats, 0.675)
  assert.ok(Math.abs(sceneTint[0] + multiply[0] - 1) < 1e-9, 'the image keeps what the glow leaves')
  assert.deepEqual([...channelScale([0.1, 0.2, 0.3, 0.4])], [0.1, 0.2, 0.1, 0.4])
})

type Texels = number[][][]
const grid = (w: number, h: number, f: (x: number, y: number, c: number) => number): Texels =>
  Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => [0, 1, 2, 3].map((c) => f(x, y, c))),
  )

/** The shipped transform's passes over `shape`, one thread standing for the workgroup: the rows, the
 *  columns — each channel times `kernel`'s spectrum where it convolves — and the rows back. */
function transformed(
  texels: Texels,
  kernel: number[][],
  planes: number[][],
  shape: ReturnType<typeof transformShape>,
) {
  const [table, written, words] = [
    twiddleTable(256),
    new Map<string, number[]>(),
    new Float32Array(FFT_PARAMS.words),
  ]
  writeTransformWords(words, shape, [1, 1, 1, 1])
  const at = FFT_PARAMS.at
  const field = (n: 'size' | 'rois' | 'mode') => [
    ...new Uint32Array(words.buffer).slice(at[n], at[n] + 4),
  ]
  const names = ['forwardRows', 'convolveColumns', 'inverseRows'] as const
  const run = shaderRun<Record<(typeof names)[number], (at: number[], lane: number) => void>>(
    fftShader(256),
    [...names],
    {
      LANES: 1,
      reverseBits: (x: number) =>
        parseInt([...Array(32)].map((_, b) => (x >>> b) & 1).join(''), 2) >>> 0,
      workgroupBarrier: () => undefined,
      fft: {
        size: field('size'),
        rois: field('rois'),
        mode: field('mode'),
        normBy: [...NORMALISED_BY],
        scale: [1, 1, 1, 1],
      },
      source: 's',
      planes,
      kernelPlanes: kernel,
      factors: Array.from({ length: 128 }, (_, k) => [table[2 * k], table[2 * k + 1]]),
      glowOut: 'o',
      waves: Array.from({ length: 256 }, () => [0, 0]),
      textureLoad: (_: string, p: number[]) => texels[p[1]][p[0]],
      textureStore: (_: string, p: number[], v: number[]) => void written.set(p.join(','), v),
    },
  )
  for (let s = 0; s < shape.lines; s++) run.forwardRows([s, 0, 0], 0)
  for (let c = 0; c < shape.columns; c++) run.convolveColumns([c, 0, 0], 0)
  if (shape.convolve) for (let s = 0; s < shape.lines; s++) run.inverseRows([s, 0, 0], 0)
  return written
}

test('the transform’s passes convolve as a direct sum does, whichever direction goes first', () => {
  for (const horizontalFirst of [true, false]) {
    const [w, h, side] = horizontalFirst ? [6, 5, 16] : [5, 6, 16]
    const image = grid(w, h, (x, y, c) => 1 + ((x * 7 + y * 3 + c * 5) % 11) / 4)
    const kernel = grid(
      side,
      side,
      (x, y, c) => ((x + y) % 5 ? 0.05 : 0.2 + ((x * y) % 3)) * (c + 1),
    )
    const plan = planConvolution(
      { view: [w, h], percent: 100, size: 1, bufferScale: 0 },
      { side: 4096, maxLine: 256, bytes: 2 ** 30 },
    )
    const square = {
      ...plan,
      horizontalFirst,
      frequency: [side, side] as [number, number],
      columns: side / 2 + 1,
    }
    const spectrum: number[][] = []
    transformed(kernel, [], spectrum, transformShape({ ...square, image: [side, side] }, true))
    const glow = transformed(
      image,
      spectrum,
      [],
      transformShape({ ...square, image: [w, h] }, false),
    )
    const sums = [0, 1, 2, 3].map((c) => kernel.flat().reduce((sum, texel) => sum + texel[c], 0))
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0
          for (let v = 0; v < h; v++)
            for (let u = 0; u < w; u++)
              sum += image[v][u][c] * kernel[(y - v + side) % side][(x - u + side) % side][c]
          const expected = sum / sums[NORMALISED_BY[c]]
          assert.ok(
            Math.abs(glow.get(`${x},${y}`)![c] - expected) < 1e-5 * (1 + expected),
            `${horizontalFirst} ${x},${y},${c}`,
          )
        }
  }
})
