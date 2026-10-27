// The translucent layers of an image (`encodeBlend`): with the depth of field drawn, the pools of the
// pass before it are drawn first and composed onto the lit image at once, the others after, composed
// once the depth of field has read the image; without it, one draw, composed later.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { TranslucencyPass } from '../../../../sdk-core/src/world/constants/index.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createTranslucency } from '../../blend/translucency.ts'
import { TRANSLUCENCY_COMPOSE_PASS, TRANSPARENTS_PASS } from '../../diagnostic/stage/passLabels.ts'
import { drawing } from './encodeEffects.fixture.ts'
import { encodeBlend } from './encodeBlend.ts'
import { encodeFrontPass } from '../../blend/frontPass.ts'
import { frontStamp } from '../../lighting/reflections/frontLayer.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { translucencyPassBit as bit } from '../../blend/translucencyPasses.ts'

/** A runtime drawing a pool of each of `passes`, 20 m ahead of the camera, whose draw records the pass
 *  it was asked. */
function drawingPool(chain: EffectChain, passes: readonly TranslucencyPass[]) {
  const kit = fakeDevice()
  const rt = drawing(chain)
  const pools = passes.map((translucencyPass) => {
    const pool = new ParticlePool({ capacity: 8, origin: [0, 0, -20], translucencyPass })
    pool.emit(0, 0, -20, 0, 1, 0, 2)
    pool.flush()
    return pool
  })
  const sides: unknown[] = []
  const cam = { eye: [0, 0, 0], world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
  Object.assign(rt.context, { particles: pools })
  Object.assign(rt.run, { lastCamera: cam, gate: { cam } })
  Object.assign(rt.gpu, {
    particles: {
      run: () => 0,
      draw: (_: unknown, view: { passes?: number }) => sides.push(view.passes),
    },
    depthView: {},
    hdrView: {},
    responsive: { view: {} },
    translucency: createTranslucency(kit.device, 8, 4, true, [8, 4]),
  })
  Object.assign(rt.gpu.deferred!, { toneLut: { words: [] } })
  return { rt, kit, sides }
}

const passLabels = (passes: { label?: string }[]) => passes.map(({ label }) => label)

test('with the depth of field drawn, the pass before it is drawn and composed first', async () => {
  const chain = new EffectChain()
  chain.add(effect.depthOfField({ focusDistance: 3 }))
  const { rt, kit, sides } = drawingPool(chain, ['beforeDepthOfField', 'afterDepthOfField'])
  // The first image asks the compose pipelines (the frames wait for them) and composes nothing.
  encodeBlend(rt, kit.device, kit.device.createCommandEncoder(), undefined, [])
  await pipelinesSettled(kit.device, true)
  kit.passes.length = 0
  sides.length = 0
  const encoder = kit.device.createCommandEncoder()
  encodeBlend(rt, kit.device, encoder, undefined, [])
  // Each pass draws its own pool; the first is composed onto the lit image at once, the second left
  // to the composition after the depth of field.
  assert.deepEqual(sides, [bit('beforeDepthOfField'), bit('afterDepthOfField')])
  assert.deepEqual(passLabels(kit.passes), [
    TRANSPARENTS_PASS,
    TRANSLUCENCY_COMPOSE_PASS,
    TRANSPARENTS_PASS,
  ])
  assert.equal(rt.gpu.translucency!.phase, 'drawn', 'the later pass waits for the depth of field')
})

test('a lone pass before the depth of field is composed at once and draws every pool', async () => {
  const chain = new EffectChain()
  chain.add(effect.depthOfField({ focusDistance: 3 }))
  const { rt, kit, sides } = drawingPool(chain, ['beforeDepthOfField'])
  encodeBlend(rt, kit.device, kit.device.createCommandEncoder(), undefined, [])
  await pipelinesSettled(kit.device, true)
  kit.passes.length = 0
  sides.length = 0
  encodeBlend(rt, kit.device, kit.device.createCommandEncoder(), undefined, [])
  assert.deepEqual(sides, [undefined])
  assert.deepEqual(passLabels(kit.passes), [TRANSPARENTS_PASS, TRANSLUCENCY_COMPOSE_PASS])
  assert.equal(
    rt.gpu.translucency!.phase,
    'idle',
    'composed: nothing waits for the depth of field, and the temporal pass reads none of it',
  )
})

test('without a depth of field the layers wait for the composition after it', () => {
  const { rt, kit, sides } = drawingPool(new EffectChain(), ['beforeDepthOfField'])
  encodeBlend(rt, kit.device, kit.device.createCommandEncoder(), undefined, [])
  assert.deepEqual(sides, [undefined], 'every pool, one draw')
  assert.deepEqual(passLabels(kit.passes), [TRANSPARENTS_PASS])
  assert.equal(rt.gpu.translucency!.phase, 'drawn', 'drawn, composed once the effects have read')
})

test('the layers after the motion blur are drawn apart into their own targets, composed later', () => {
  const chain = new EffectChain()
  const { rt, kit, sides } = drawingPool(chain, ['afterDepthOfField', 'afterMotionBlur'])
  const main = rt.gpu.translucency!
  const seen: unknown[] = []
  const draw = rt.gpu.particles!.draw
  rt.gpu.particles!.draw = (...args: Parameters<typeof draw>) => {
    seen.push(rt.gpu.translucency === main.late)
    return draw(...args)
  }
  encodeBlend(rt, kit.device, kit.device.createCommandEncoder(), undefined, [])
  assert.deepEqual(sides, [bit('afterDepthOfField'), bit('afterMotionBlur')])
  assert.deepEqual(seen, [false, true], 'the second draw reads the late set as the translucency')
  assert.equal(rt.gpu.translucency, main, 'the targets are back')
  assert.equal(main.phase, 'drawn')
  assert.equal(main.late!.phase, 'drawn', 'composed after the motion blur')
})

// `surfaceLighting.ts` encodes the whole lit image (every lighting resource, the lights, the sky): no
// fake in this suite drives it, so its order of calls is read from its text.
test("the water's depth and the front layer the sun's marking reads are drawn before the lights", () => {
  const source = readFileSync(new URL('./surfaceLighting.ts', import.meta.url), 'utf8')
  const prepared = source.indexOf('prepareBlend(rt, encoder)'),
    marked = source.indexOf('encodeMarkedLayers(rt, device, encoder, blendRuns)'),
    lights = source.indexOf('encodeDirectLights(rt, device'),
    frontPass = source.indexOf('encodeFrontPass(rt, device, encoder)')
  assert.ok(prepared >= 0 && prepared < marked, 'after the transparents are prepared')
  assert.ok(marked < lights, 'the marking, in the lights, finds them drawn')
  assert.ok(lights < frontPass, 'the front pass after the lights stands for the others')
})

test("the air is encoded before the surface cards read the sky's light and the clouds' shade", () => {
  const source = readFileSync(new URL('./encodeLights.ts', import.meta.url), 'utf8')
  const lit = source.slice(source.indexOf('export function encodeDirectLights'))
  const uploaded = lit.indexOf('uploadSceneLights(device, lights)'),
    shadows = lit.indexOf('encodeVsmFrame('),
    air = lit.indexOf('encodeAir('),
    cards = lit.indexOf('lightSurfaceCards(')
  assert.ok(
    uploaded >= 0 && uploaded < air,
    'the light buffer is pushed before the atmosphere reads it',
  )
  assert.ok(
    shadows > uploaded && shadows < air,
    'the air reads this image shadow pages, not the last',
  )
  assert.ok(air < cards, 'the cards read this image air, not the last')
  const unlit = source.slice(
    source.indexOf('function encodeUnlitView'),
    source.indexOf('function ensureLightGrid'),
  )
  const unlitAir = unlit.indexOf('encodeAir(')
  assert.ok(unlitAir >= 0 && unlitAir < unlit.indexOf('lightSurfaceCards('), 'the unlit view too')
  const airBody = source.slice(
    source.indexOf('function encodeAir'),
    source.indexOf('function encodeUnlitView'),
  )
  assert.ok(
    airBody.indexOf('encodeAtmosphere(') >= 0 &&
      airBody.indexOf('encodeAtmosphere(') < airBody.indexOf('encodeSkyCapture('),
    'the sky light capture is made over this image air, before the cards',
  )
})

test('the front pass drawn for this image is not drawn again', () => {
  const rt = {
    run: { frame: 7 },
    gpu: { reflection: { front: { wanted: true, drawn: frontStamp(7) } }, depthTexture: {} },
    vis: { gpuHiz: {}, blendPipelines: {} },
    blendState: { runCount: 1 },
  } as unknown as WebgpuPagesRuntime
  const unused = new Proxy(
    {},
    {
      get: () => {
        throw new Error('the encoder is used')
      },
    },
  ) as GPUCommandEncoder
  assert.equal(encodeFrontPass(rt, {} as GPUDevice, unused), undefined)
})
