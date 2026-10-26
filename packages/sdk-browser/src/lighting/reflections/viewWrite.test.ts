// The reflection's view uniform, as each image writes it: the pixel scale, the geometry of a surface's
// thickness, the held image and whether the screen traces, what a ray may spend, written only when
// they changed, and nothing in them turning with the frame. The settings' reader and the census
// have their own file (`settings.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_CONSTANTS, REFLECTION_COUNTS } from './constants.ts'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { heldImage } from './heldImage.fixture.ts'
import { screenRelativeThickness } from '../../visibility/hiz/gpu/screenSlab.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import {
  REFLECTION_RULES,
  resolveReflections,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { perspectiveProjection } from '../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { FakeBuffer } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

/** A device whose queue lays each write into the words of one view uniform: what the buffer holds
 *  after each call, and the writes it took. */
function viewDevice() {
  const gpu = fakeDevice()
  const buffer = gpu.device.createBuffer({
    size: (REFLECTION_VIEW_WORDS + 16) * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { data } = buffer as unknown as FakeBuffer
  const words = new Float32Array(data.buffer, data.byteOffset, REFLECTION_VIEW_WORDS + 16)
  const held = {
    words,
    bits: new Uint32Array(words.buffer, words.byteOffset, words.length),
    get writes() {
      return gpu.writes.length
    },
    /** The word past the last one written. */
    get last() {
      return Math.max(0, ...gpu.writes.map((w) => (w.offset + w.data.byteLength) / 4))
    },
  }
  return { device: gpu.device, buffer, held }
}

test('the scene’s reach travels with the view, the far bound when the frame names none', () => {
  const { device, buffer, held: sent } = viewDevice()
  const write = createReflectionViewWriter(device, buffer)
  const frame = {
    viewProjection: perspectiveProjection(new Float64Array(16), 60, 2, 0.1, 1),
    size: [400, 300] as const,
    depthDrawn: true,
    eye: [0, 0, 0],
  }
  const at = REFLECTION_VIEW_AT.reach + 2
  write(frame, heldImage())
  assert.equal(sent.words[at], REFLECTION_CONSTANTS.REFLECTION_FAR)
  write({ ...frame, sceneReach: 1234.5 }, heldImage())
  assert.equal(sent.words[at], 1234.5)
})

test('the view uniform carries the pixel scale, the held image, the slab and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const viewProjection = perspectiveProjection(new Float64Array(16), 60, 2, 0.1, 1)
  const { device, buffer, held: sent } = viewDevice()
  const write = createReflectionViewWriter(device, buffer)
  const held = heldImage({ viewProjection: new Float64Array(16).fill(2), size: [200, 100] })
  const frame = {
    viewProjection,
    size: [400, 300] as const,
    depthDrawn: true,
    eye: [0, 0, 0],
  }
  write(frame, held)
  const { words, bits: traced } = sent
  // The world size of a pixel one unit away: 2·tan(30°) / 300, a perspective whose depth at an
  // infinite distance is zero.
  assert.ok(
    Math.abs(words[REFLECTION_VIEW_AT.slab] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6,
  )
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.slab + 1, REFLECTION_VIEW_AT.slab + 4)],
    [0, Math.fround(0.1), 1],
  )
  // The reference walk's thickness: a perspective's scale is 1.
  assert.equal(words[REFLECTION_VIEW_AT.thickness], Math.fround(0.005))
  assert.deepEqual(
    [words[REFLECTION_VIEW_AT.radiance], words[REFLECTION_VIEW_AT.radiance + 1]],
    [200, 100],
  )
  assert.equal(words[REFLECTION_VIEW_AT.radianceViewProj], 2, "the held image's view-projection")
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'no held image: the environment alone')
  assert.ok(sent.last <= REFLECTION_VIEW_WORDS, 'the view and no word past it')
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)],
    [0, 0, 0, 0],
    'no background declared: a ray that leaves the scene reaches the environment',
  )
  write(frame, { ...held, valid: true })
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 1)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true })
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'a stale depth is never marched')
  // A still view writes once: nothing in the words turns with the frame.
  const writes = sent.writes
  write({ ...frame, depthDrawn: false }, { ...held, valid: true })
  write({ ...frame, depthDrawn: false }, { ...held, valid: true })
  assert.equal(sent.writes, writes)
})

/** The reflections' settings the options give, over the screen probes' the options give too. */
const reflections = (options: object) =>
  resolveReflections(resolveSettings(REFLECTION_RULES, options), screenProbeSettings(options))

/** A writer over a still held image of 64 × 32, and a perspective frame of that size carrying
 *  `extra`. */
function stillView<Extra extends object>(extra: Extra) {
  const { device, buffer, held: sent } = viewDevice()
  const held = heldImage({
    valid: true,
    viewProjection: new Float64Array(16).fill(1),
    size: [64, 32],
  })
  const frame = {
    viewProjection: perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1),
    size: [64, 32] as const,
    depthDrawn: true,
    eye: [0, 0, 0],
    ...extra,
  }
  return { sent, write: createReflectionViewWriter(device, buffer), held, frame }
}

test("the slab follows the projection: a perspective's depth at infinity, an orthographic one's step", () => {
  const slab = (
    viewProjection: number[],
    size: readonly [number, number],
    eye: number[] = [0, 0, 0],
  ) => {
    const { device, buffer, held: sent } = viewDevice()
    const held = heldImage()
    createReflectionViewWriter(device, buffer)(
      { viewProjection, size, depthDrawn: true, eye },
      held,
    )
    return [...sent.words.slice(REFLECTION_VIEW_AT.slab, REFLECTION_VIEW_AT.slab + 4)]
  }
  // A finite reversed perspective, near 0.1 and far 100: z = n(f − w) / (w(f − n)) = A + B / w.
  const n = 0.1,
    far = 100
  const finite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, n / (far - n), -1, 0, 0, (n * far) / (far - n), 0]
  const [scale, atInfinity, step, perspective] = slab(finite, [1000, 500])
  assert.equal(scale, Math.fround(0.004))
  assert.ok(Math.abs(atInfinity - -n / (far - n)) < 1e-6, `${atInfinity}`)
  assert.ok(Math.abs(step - (n * far) / (far - n)) < 1e-6, `${step}`)
  assert.equal(perspective, 1)
  // An orthographic projection: its depth spans `scale · |∇z|` for a pixel's thickness.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
  assert.deepEqual(slab(identity, [10, 4]), [0.5, 0, 1, 0])
  // The depth of the eye's plane, the clip depth at the eye: 2 · 3 at an eye three units along z.
  assert.equal(slab(identity, [10, 4], [0, 0, 3])[1], 6)
  // The orthographic scale of the thickness falls by tens with the depth range, counted in
  // centimetres (the world is in metres): a range of 50 cm keeps a tenth, one of 1000 m (10⁵ cm)
  // five digits.
  const wide = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 / 1000, 0, 0, 0, 0, 1]
  assert.ok(Math.abs(screenRelativeThickness(identity, 0.005) - 0.0005) < 1e-12)
  assert.ok(Math.abs(screenRelativeThickness(wide, 0.005) - 5e-8) < 1e-15)
})

test('a still view with transparents writes its view once: the front pass sets a flag, never a frame rank', () => {
  // An image whose trace answers the transparents' front surface, image after image, sends the same
  // words.
  const { sent, write, held, frame } = stillView({ front: true })
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.front], 1, 'the front answered')
  const writes = sent.writes
  for (let image = 0; image < 4; image++) write(frame, held)
  assert.equal(sent.writes, writes, 'nothing sent again')
  frame.front = false
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.front], 0, 'no front answered')
})

test('the reflections’ turn is the view’s, and an unchanged view sends nothing', () => {
  const { sent, write, held, frame } = stillView({ turn: 7 })
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal], 7)
  const writes = sent.writes
  write(frame, held)
  assert.equal(sent.writes, writes, 'the turn held: nothing sent')
})

/** The flags of what a view does besides the stages of the trace: every one on by default. */
const DONE =
  REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES |
  REFLECTION_COUNTS.REFLECTION_TEMPORAL |
  REFLECTION_COUNTS.REFLECTION_RECONSTRUCTION |
  REFLECTION_COUNTS.REFLECTION_BILATERAL |
  REFLECTION_COUNTS.REFLECTION_SCENE_COLOR |
  REFLECTION_COUNTS.REFLECTION_HEIGHT_FOG |
  REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE
const SCENE = REFLECTION_COUNTS.REFLECTION_SCENE_TRACES
const DISTANT = REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES

/** The lanes of the view a still frame writes, each as four words (`uints` as they are, the others as floats). */
function lanesOf(extra: object) {
  const { sent, write, held, frame } = stillView(extra)
  write(frame, held)
  const words = (field: keyof typeof REFLECTION_VIEW_AT) =>
    sent.bits.slice(REFLECTION_VIEW_AT[field], REFLECTION_VIEW_AT[field] + 4)
  const floats = (field: keyof typeof REFLECTION_VIEW_AT) => {
    const lane = words(field)
    return [...new Float32Array(lane.buffer, lane.byteOffset, 4)].map((x) => Math.fround(x))
  }
  return { words, floats }
}

test('a ray’s budget and stages travel with the view: the reference’s by default, the settings’ otherwise', () => {
  const lanes = (extra: object) => {
    const { words, floats } = lanesOf(extra)
    return [[...words('scene')], floats('reach')]
  }
  const { scene, reach } = { scene: 0, reach: 1 }
  // The fourth word is the front layer's own flags (`frontSceneTraces` and its four neighbours), asserted apart.
  const opaque = (extra: object) => lanes(extra)[scene].slice(0, 3)
  // 50 iterations of the screen and 16 steps of the far trace; the scene and the far trace on; 5 cm a ray leaves a
  // surface by, and 2 km the far trace's length.
  const every = lanes({})
  assert.deepEqual(opaque({}), [50, 16, SCENE | DISTANT | DONE])
  assert.equal(
    every[scene][3],
    SCENE | DISTANT | DONE,
    'the front layer, by default, does what the opaque one does',
  )
  assert.deepEqual(
    every[reach],
    [0.05, 2000, REFLECTION_CONSTANTS.REFLECTION_FAR, 0].map(Math.fround),
    'the scene’s reach is the far bound without probes',
  )
  const asked = (options: object) => ({ settings: reflections(options) })
  assert.deepEqual(opaque(asked({ reflectionScreenSteps: 20, reflectionDistantScreenSteps: 8 })), [
    20,
    8,
    SCENE | DISTANT | DONE,
  ])
  assert.deepEqual(
    opaque(asked({ screenProbeSceneTraces: false })),
    [50, 16, DISTANT | DONE],
    'the scene trace off',
  )
  assert.deepEqual(opaque(asked({ reflectionDistantScreenTraces: false })), [50, 16, SCENE | DONE])
  // The far trace needs the screen: with the screen traces off neither is on.
  assert.deepEqual(opaque(asked({ reflectionScreenTraces: false })), [
    50,
    16,
    (SCENE | DONE) &
      ~REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES &
      ~REFLECTION_COUNTS.REFLECTION_SCENE_COLOR,
  ])
  // The surface bias is the screen probes' own, and travels with them.
  assert.equal(lanes(asked({ screenProbeSurfaceBias: 0.2 }))[reach][0], Math.fround(0.2))
})

test('the reference’s settings of the trace and the denoiser travel with the view, its level’s row too', () => {
  const lanes = (options: object) => lanesOf({ settings: reflections(options) })
  const every = lanes({})
  // The march: 0.5 % of the depth for a surface, the far trace's slope tolerance 2 and offset bias 0, rays 200 m long.
  assert.deepEqual(every.floats('march'), [0.005, 2, 0, 200].map(Math.fround))
  // The ceiling of a ray 40, the lit image taken within 1 % of the depth and 85°, the sky fogged over 1 000 m.
  assert.deepEqual(
    every.floats('light'),
    [40, 0.01, Math.cos((85 * Math.PI) / 180), 1000].map(Math.fround),
  )
  // The history's 12 images, the clamp's scale 1, the distance threshold 0.03, the tonemap range 10.
  assert.deepEqual(every.floats('denoise'), [12, 1, 0.03, 10].map(Math.fround))
  // The reconstruction's radius 8, the bilateral filter's 8, the least weight of the level 0, 2 frames of disocclusion.
  assert.deepEqual(every.floats('spread'), [8, 8, 0, 2])
  // Roughness 0.4 and its fade 0.1, the sampling's bias 0.1.
  assert.deepEqual(every.floats('lobe'), [0.4, 0.1, 0.1, 0].map(Math.fround))
  // The level 'ultra' (the default): a ray a pixel, five neighbours; 1 024 ray directions.
  assert.deepEqual([...every.words('taps')], [5, 4, 1024, 0])
  assert.deepEqual([...every.words('grid').slice(0, 3)], [64, 32, 1])
  // The level 'high': a ray a block of 2 × 2, three neighbours, the least weight 1; 'off': no lobe traces.
  const high = lanes({ reflectionQuality: 'high' })
  assert.deepEqual([...high.words('grid').slice(0, 3)], [32, 16, 2])
  assert.equal(high.words('taps')[0], 3)
  assert.equal(high.floats('spread')[2], 1)
  assert.equal(lanes({ reflectionQuality: 'off' }).floats('lobe')[0], 0)
  assert.equal(lanes({ reflectionQuality: false }).floats('lobe')[0], 0, 'false is off')
  assert.equal(
    lanes({ reflectionQuality: true }).floats('lobe')[0],
    Math.fround(0.4),
    'true the default level',
  )
})
