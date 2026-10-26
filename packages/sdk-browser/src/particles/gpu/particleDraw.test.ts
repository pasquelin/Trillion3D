// The CPU half of the WebGPU particle draw (#755); the GPU's part is the recette's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import type { TranslucencyPass } from '../../../../sdk-core/src/world/constants/index.ts'
import { translucencyPassBit } from '../../blend/translucencyPasses.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { ParticlePool, type ParticlePoolSpec } from '../../../../sdk-core/src/fluids/particles.ts'
import { DRAW, DRAW_FLOATS, writeDrawWords, writeViewAxes } from '../drawWords.ts'
import { createWebgpuParticleDraw } from './webgpuParticleDraw.ts'
import { PARTICLE_DRAW_WGSL, particleDrawShader } from './particlesWgsl.ts'
import { createWebgpuParticles } from './webgpuParticles.ts'
import { askParticles, encodeParticles } from './webgpuParticleFrame.ts'
import { pipelinesCompiling } from '../../lighting/deferred/compileLedger.ts'
import { gatedDevice } from '../../lighting/deferred/gatedDevice.fixture.ts'
import { families } from '../../session/host/families.ts'
import { PARTICLE_DRAW_PASS } from '../../diagnostic/stage/passLabels.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** The device the pools' step states are made on. */
const { device: states } = fakeDevice()

/** Smoke 2 m ahead with three stepped particles, fire 20 m ahead with two, an empty pool at 50 m. */
function scene(fire: Partial<ParticlePoolSpec> = {}) {
  const pool = (z: number, n: number, spec: Partial<ParticlePoolSpec> = {}) => {
    const made = new ParticlePool({ capacity: 8, origin: [0, 0, z], ...spec })
    for (let i = 0; i < n; i++) made.emit(0, 0, z, 0, 1, 0, 2)
    made.flush()
    return made
  }
  return [pool(-2, 3, { blend: 'premultiplied' }), pool(-20, 2, fire), pool(-50, 0)]
}

test('a pool 10 km out is drawn from its origin: the words hold to the millimetre', () => {
  const pool = new ParticlePool({ capacity: 8, origin: [1e4, 0, 1e4], size: 0.5 }),
    eye = [1e4 + 0.001, 0, 1e4],
    view = [...IDENTITY.slice(0, 12), -eye[0], -eye[1], -eye[2], 1],
    words = new Float32Array(DRAW_FLOATS)
  writeDrawWords(words, pool, view)
  // Origin to eye and back, the softness (a pool's size by default): each to the millimetre.
  const got = [12, 13, 15, 28, DRAW.at.softness].map((i) => words[i])
  assert.deepEqual(got, [-0.001, 0, 1, 0.001, 0.5].map(Math.fround))
})

test('a view’s axes are the camera’s, whatever the camera turns to or the view mirrors, and a pool’s words keep them', () => {
  const pool = new ParticlePool({ capacity: 8, origin: [3, 0, -2] }),
    words = new Float32Array(DRAW_FLOATS)
  // A camera at the origin turned a quarter to its left looks along −x, its right along −z; the
  // mirrored one has its axes in the other hand, and still looks the same way.
  const turned = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
    mirrored = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
  for (const [world, right] of [
    [turned, [0, 0, -1]],
    [mirrored, [0, 0, 1]],
  ] as const) {
    // A camera of scale 2 has the same unit axes.
    writeViewAxes(
      words,
      world.map((x) => 2 * x),
    )
    writeDrawWords(words, pool, IDENTITY)
    const axes = [DRAW.at.right, DRAW.at.up, DRAW.at.forward].map((at) =>
      Array.from(words.slice(at, at + 3)),
    )
    for (const [got, want] of [
      [axes[0], right],
      [axes[1], [0, 1, 0]],
      [axes[2], [-1, 0, 0]],
    ])
      got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 1e-6, `${got} is not ${want}`))
  }
})

test('a pool takes the view’s clip plane from its origin, none for a view without', () => {
  const pool = new ParticlePool({ capacity: 8, origin: [3, 4, -20] }),
    words = new Float32Array(DRAW_FLOATS)
  // The world plane z = -5 keeps what lies above it: a particle at local z, at z - 20 in the world.
  writeDrawWords(words, pool, IDENTITY, [0, 0, 1, 5])
  assert.deepEqual(Array.from(words.slice(DRAW_FLOATS - 4)), [0, 0, 1, -15])
  // Slanted: the offset moves by the normal's dot with the origin.
  writeDrawWords(words, pool, IDENTITY, [0.6, 0, 0.8, 2])
  assert.ok(Math.abs(words[DRAW_FLOATS - 1] - (2 + 0.6 * 3 + 0.8 * -20)) < 1e-6)
  writeDrawWords(words, pool, IDENTITY)
  assert.deepEqual(Array.from(words.slice(DRAW_FLOATS - 4)), [0, 0, 0, 0])
})

test('a device with clip distances cuts the disc in its vertex stage, one without tests each fragment entry, a view without a plane draws with neither', () => {
  const native = particleDrawShader('distance')
  assert.ok(native.includes('enable clip_distances;'))
  assert.ok(native.includes('@builtin(clip_distances) clipDistances:array<f32,1>'))
  assert.ok(native.includes('-> OutClipped {') && native.includes('OutWithClip(o,1.0)'))
  assert.ok(native.includes('OutWithClip(o,planeDistance(draw.clipPlane, o.local))'))
  assert.ok(!native.includes('particleClipped'))
  const pixel = particleDrawShader('pixel')
  for (const entry of ['fs(in: Out) -> @location(0) vec4f', 'fsRouted(in: Out) -> Routed'])
    assert.ok(
      pixel.includes(`@fragment fn ${entry} {\n if (particleClipped(in)) { discard; }`),
      entry,
    )
  assert.ok(!pixel.includes('clip_distances'))
  // The module of a view without a plane: no member, no distance, no test.
  assert.equal(particleDrawShader(), PARTICLE_DRAW_WGSL)
  for (const text of ['clip_distances', 'clipPlane', 'particleClipped', 'OutClipped'])
    assert.ok(!PARTICLE_DRAW_WGSL.includes(text), `${text} is not in the plain module`)
})

/** One of the kit's encoders, and what its render passes took: each pass's label, then each
 *  indirect draw as `pipeline buffer offset` (`log`); the views each pass attaches. */
function renderRecorder() {
  const kit = fakeDevice()
  const log = () =>
    kit.passes.flatMap(({ label, commands }) => {
      let pipeline: GPURenderPipeline | undefined
      return [
        `${label}`,
        ...commands.flatMap(([name, [first, at]]) => {
          if (name === 'setPipeline') pipeline = first as GPURenderPipeline
          return name === 'drawIndirect'
            ? [[pipeline?.label, (first as GPUBuffer).label, at].join(' ')]
            : []
        }),
      ]
    })
  const attached = () => kit.passes.map(({ colors }) => colors.map((color) => color?.view))
  return { encoder: kit.device.createCommandEncoder(), log, attached }
}

const view = {} as GPUTextureView,
  // A pool's step state: the draw reads its instances from the window its step wrote there.
  kept = () =>
    ({
      state: states.createBuffer({
        label: 'state',
        size: 64,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
      }),
    }) as never
const frame = (encoder: GPUCommandEncoder) => ({
  encoder,
  target: view,
  depth: view,
  size: [8, 8],
  viewProj: IDENTITY,
  world: IDENTITY,
  eye: [0, 0, 0],
})

test('WebGPU: one pass, fire then the nearer smoke, each with its blend; none without particles', async () => {
  const gpu = fakeDevice(),
    pools = scene()
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`))
  await tick()
  const { encoder, log, attached } = renderRecorder()
  assert.equal(draw.draw([], frame(encoder)) + draw.draw([pools[2]], frame(encoder)), 0)
  assert.deepEqual(log(), [], 'no particle alive: no pass, no pixel')
  assert.equal(draw.draw(pools, frame(encoder)), 2)
  assert.deepEqual(
    log(),
    [
      PARTICLE_DRAW_PASS,
      `${PARTICLE_DRAW_PASS} additive state 0`,
      `${PARTICLE_DRAW_PASS} premultiplied state 0`,
    ],
    'far to near',
  )
  // The translucency target alone.
  assert.deepEqual(attached(), [[view]])
  const blends = gpu.renderPipelines.map(({ fragment }) => {
    const { color, alpha } = (fragment!.targets as GPUColorTargetState[])[0].blend!
    return [color.dstFactor, alpha.srcFactor, alpha.dstFactor].join(' ')
  })
  // The layers' blends: fire adds its light and leaves the transmittance, smoke covers as an
  // alphaComposite layer does and lets the rest through.
  const over = 'one-minus-src-alpha'
  assert.deepEqual(blends, ['one zero one', `${over} zero ${over}`])
})

test('WebGPU: a pass of the depth of field draws the pools of that pass alone', async () => {
  const gpu = fakeDevice(),
    pools = scene({ translucencyPass: 'beforeDepthOfField' })
  const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`))
  await tick()
  // The fire is drawn before the depth of field, the smoke (the default pass) after it.
  const drawnOn = (pass: TranslucencyPass) => {
    const { encoder, log } = renderRecorder()
    const passes = translucencyPassBit(pass)
    return [draw.draw(pools, { ...frame(encoder), passes }), log().slice(1)] as const
  }
  assert.deepEqual(drawnOn('beforeDepthOfField'), [1, [`${PARTICLE_DRAW_PASS} additive state 0`]])
  assert.deepEqual(drawnOn('afterDepthOfField'), [
    1,
    [`${PARTICLE_DRAW_PASS} premultiplied state 0`],
  ])
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
  assert.equal(log().length, 3, 'one pass, two routed draws')
  assert.equal(routedMade().length, 2, 'one per blend')
  assert.equal(gpu.compiled.sync, 0, 'compiled off the frame')
})

test('WebGPU: the project switch picks the draw’s text once: none of the plane’s code without it, one set with it', async () => {
  const codes = async (clipping?: 'pixel' | 'distance') => {
    const gpu = gatedDevice(),
      pools = scene()
    const draw = createWebgpuParticleDraw(gpu.device, kept, (e) => assert.fail(`${e}`), clipping)
    await gpu.land()
    await gpu.land()
    draw.draw(pools, { ...frame(gpu.device.createCommandEncoder()), clipPlane: [0, 0, 1, 0] })
    return gpu.renderPipelines.map(
      ({ vertex }) => (vertex.module as unknown as { code: string }).code,
    )
  }
  const [off, pixel, distance] = [await codes(), await codes('pixel'), await codes('distance')]
  assert.deepEqual(
    [off.length, pixel.length, distance.length],
    [2, 2, 2],
    'a pipeline a blend, one set',
  )
  assert.ok(off.every((code) => !code.includes('clipPlane') && !code.includes('clip_distances')))
  assert.ok(pixel.every((code) => code.includes('particleClipped')))
  assert.ok(distance.every((code) => code.includes('enable clip_distances;')))
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
  assert.deepEqual([heard.length, smoke.refused, log().length], [1, true, 0])
})

test('WebGPU: the pools step once a frame, on the main view; another view draws them as they are', () => {
  let steps = 0
  const [smoke] = scene(),
    main = {},
    views = { main, active: {} },
    gpu = { particles: { run: () => (steps++, 1) } },
    rt = { context: { particles: [smoke] }, gpu, run: {}, views }
  const { device } = fakeDevice()
  const encode = () => encodeParticles(rt as never, device, device.createCommandEncoder())
  encode()
  assert.equal(steps, 0, 'another view steps nothing')
  views.active = main
  encode()
  assert.equal(steps, 1)
})

test("WebGPU: the step is made at the frame's entry on the particles' code the frame waited for (#1353), its draw cutting at the plane the way the session's switch says", async () => {
  const [smoke] = scene(),
    main = {},
    gpu: { particles?: object } = {},
    rt = {
      context: { particles: [] },
      gpu,
      run: {},
      views: { main },
      setup: { clipping: 'pixel' },
    }
  const kit = fakeDevice()
  Object.assign(rt.views, { active: main })
  const enter = () => askParticles(rt as never, kit.device)
  enter()
  assert.equal(gpu.particles, undefined, 'a world without pools makes no step')
  rt.context.particles = [smoke] as never
  await families.particles.load() // what the frame that draws a pool waits for (`familyUse.ts`)
  enter()
  assert.ok(gpu.particles, 'the step is made on the code that arrived')
  await tick()
  await tick()
  const draws = kit.renderPipelines.map(
    ({ vertex }) => (vertex.module as unknown as { code: string }).code,
  )
  assert.ok(draws.length > 0 && draws.every((code) => code.includes('particleClipped')))
})
