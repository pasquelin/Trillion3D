// The CPU half of the WebGPU particle draw (#755); the GPU's part is the recette's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { ParticlePool, type ParticlePoolSpec } from '../../../../sdk-core/src/fluids/particles.ts'
import { DRAW_FLOATS, writeDrawWords } from '../../particles/drawWords.ts'
import { createWebgpuParticleDraw } from './webgpuParticleDraw.ts'
import { createWebgpuParticles } from './webgpuParticles.ts'
import { askParticles, encodeParticles } from './webgpuParticleFrame.ts'
import { pipelinesCompiling } from '../../lighting/deferred/compileLedger.ts'
import { gatedDevice } from '../../lighting/deferred/gatedDevice.fixture.ts'
import { families } from '../../host/families.ts'
import { PARTICLE_DRAW_PASS as P } from '../../stage/passLabels.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Smoke 2 m ahead with three stepped particles, fire 20 m ahead with two, an empty pool at 50 m. */
function scene() {
  const pool = (z: number, n: number, spec: Partial<ParticlePoolSpec> = {}) => {
    const made = new ParticlePool({ capacity: 8, origin: [0, 0, z], ...spec })
    for (let i = 0; i < n; i++) made.emit(0, 0, z, 0, 1, 0, 2)
    made.flush()
    return made
  }
  return [pool(-2, 3, { blend: 'premultiplied' }), pool(-20, 2), pool(-50, 0)]
}

test('a pool 10 km out is drawn from its origin: the words hold to the millimetre', () => {
  const pool = new ParticlePool({ capacity: 8, origin: [1e4, 0, 1e4], size: 0.5 }),
    eye = [1e4 + 0.001, 0, 1e4],
    view = [...IDENTITY.slice(0, 12), -eye[0], -eye[1], -eye[2], 1],
    words = new Float32Array(DRAW_FLOATS)
  writeDrawWords(words, pool, view, eye)
  // Origin to eye and back, eye from the origin, size, colour, softness: each to the millimetre.
  const got = [12, 13, 15, 28, 32, 35, 36, 37, 38, 39, 40].map((i) => words[i])
  assert.deepEqual(got, [-0.001, 0, 1, 0.001, 0.001, 0.5, 1, 0.8, 0.5, 1, 0.5].map(Math.fround))
})

/** An encoder that logs its render passes, and each draw's pipeline and indirect arguments. */
function renderRecorder() {
  const log: string[] = [],
    attached: unknown[][] = []
  const beginRenderPass = ({ label, colorAttachments }: GPURenderPassDescriptor) => {
    let pipeline: GPURenderPipeline
    log.push(`${label}`)
    attached.push([...colorAttachments].map((attachment) => attachment?.view))
    return {
      setPipeline: (set: GPURenderPipeline) => void (pipeline = set),
      setBindGroup() {},
      setViewport() {},
      drawIndirect: (args: GPUBuffer, at: number) =>
        void log.push([pipeline.label, args.label, at].join(' ')),
      end() {},
    }
  }
  return { encoder: { beginRenderPass } as unknown as GPUCommandEncoder, log, attached }
}

const view = {} as GPUTextureView,
  reactive = { label: 'reactive' } as unknown as GPUTextureView,
  // A pool's step state: the draw reads its instances from the window its step wrote there.
  kept = () => ({ state: { label: 'state' } }) as never
const frame = (encoder: GPUCommandEncoder) => ({
  encoder,
  target: view,
  reactive,
  depth: view,
  size: [8, 8],
  viewProj: IDENTITY,
  eye: [0, 0, 0],
})

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene()
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`))
  await tick()
  const { encoder, log, attached } = renderRecorder()
  assert.equal(draw.draw([], frame(encoder)) + draw.draw([pools[2]], frame(encoder)), 0)
  assert.deepEqual(log, [], 'no particle alive: no pass, no pixel')
  assert.equal(draw.draw(pools, frame(encoder)), 2)
  assert.deepEqual(log, [P, `${P} additive state 0`, `${P} premultiplied state 0`], 'far to near')
  // The lit image, then the reactive value their coverage is written in (#833).
  assert.deepEqual(attached, [[view, reactive]])
  const blends = gpu.renderPipelines.map(({ fragment }) => {
    const { color, alpha } = (fragment!.targets as GPUColorTargetState[])[0].blend!
    return [color.dstFactor, alpha.srcFactor, alpha.dstFactor].join(' ')
  })
  const over = 'one-minus-src-alpha' // fire keeps the coverage, smoke covers
  assert.deepEqual(blends, ['one zero one', `${over} one ${over}`])
})

test('WebGPU: the routed draw is asked off the frame, and the image that routes finds it compiled', async () => {
  const gpu = gatedDevice(),
    pools = scene()
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`))
  await gpu.land()
  const routedMade = () =>
    gpu.renderPipelines.filter(({ fragment }) => fragment!.entryPoint === 'fsRouted')
  assert.deepEqual(routedMade(), [], 'no image routed a pool: none made')
  draw.askRouted()
  assert.equal(pipelinesCompiling(gpu.device), true, 'the frame entry holds the image on them')
  await gpu.land()
  assert.equal(pipelinesCompiling(gpu.device), false)
  const filter = { attachments: () => [], maskGroup: {} } as never
  const { encoder, log } = renderRecorder()
  assert.equal(draw.draw(pools, { ...frame(encoder), filter }), 2)
  assert.equal(log.length, 3, 'one pass, two routed draws')
  assert.equal(routedMade().length, 2, 'one per blend')
  assert.equal(gpu.compiled.sync, 0, 'compiled off the frame')
})

test('WebGPU: a draw that cannot compile is heard, and the next step keeps its pools refused', async () => {
  const heard: unknown[] = [],
    { device } = fakeDevice(),
    [smoke] = scene()
  device.createRenderPipelineAsync = () => Promise.reject(new Error('NO_PIPELINE'))
  const step = createWebgpuParticles(device, (e) => heard.push(e))
  await tick()
  const { encoder, log } = renderRecorder()
  assert.equal(step.draw([smoke], frame(encoder)), 0)
  step.run([smoke], encoder)
  assert.deepEqual([heard.length, smoke.refused, log.length], [1, true, 0])
})

test('WebGPU: the pools step once a frame, on the main view; another view draws them as they are', () => {
  let steps = 0
  const [smoke] = scene(),
    main = {},
    views = { main, active: {} },
    gpu = { particles: { run: () => (steps++, 1) } },
    rt = { context: { particles: [smoke] }, gpu, run: {}, views }
  const encode = () => encodeParticles(rt as never, fakeDevice().device, {} as GPUCommandEncoder)
  encode()
  assert.equal(steps, 0, 'another view steps nothing')
  views.active = main
  encode()
  assert.equal(steps, 1)
})

test("WebGPU: the step is made at the frame's entry on the particles' code the frame waited for (#1353)", async () => {
  const [smoke] = scene(),
    main = {},
    gpu: { particles?: object } = {},
    rt = { context: { particles: [] }, gpu, run: {}, views: { main } }
  Object.assign(rt.views, { active: main })
  const enter = () => askParticles(rt as never, fakeDevice().device)
  enter()
  assert.equal(gpu.particles, undefined, 'a world without pools makes no step')
  rt.context.particles = [smoke] as never
  await families.particles.load() // what the frame that draws a pool waits for (`familyUse.ts`)
  enter()
  assert.ok(gpu.particles, 'the step is made on the code that arrived')
})
