// The reflection's view uniform, as each image writes it: the pixel scale, the geometry of a surface's
// thickness, the held image and whether the screen traces, what a ray may spend, written only when
// they changed, and nothing in them turning with the frame; and the budget the census reports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { heldImage } from './heldImage.fixture.ts'
import { screenRelativeThickness } from '../../visibility/hiz/gpu/screenSlab.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import { createReflectionCensus } from './census.ts'
import {
  REFLECTION_RULES,
  reflectionRingTests,
  reflectionRingWork,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
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
    relativeThickness: 0.005,
    eye: [0, 0, 0],
  }
  write(frame, held, 8)
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
    [
      words[REFLECTION_VIEW_AT.radiance],
      words[REFLECTION_VIEW_AT.radiance + 1],
      words[REFLECTION_VIEW_AT.radiance + 2],
    ],
    [200, 100, 7],
  )
  assert.equal(words[REFLECTION_VIEW_AT.radianceViewProj], 2, "the held image's view-projection")
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'no held image: the environment alone')
  assert.ok(sent.last <= REFLECTION_VIEW_WORDS, 'the view and no word past it')
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)],
    [0, 0, 0, 0],
    'no background declared: a ray that leaves the scene reaches the environment',
  )
  write(frame, { ...held, valid: true }, 8)
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 1)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'a stale depth is never marched')
  // A still view writes once: nothing in the words turns with the frame.
  const writes = sent.writes
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(sent.writes, writes)
})

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
    relativeThickness: 0.005,
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
      { viewProjection, size, depthDrawn: true, relativeThickness: 0.005, eye },
      held,
      1,
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
  write(frame, held, 6)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.front], 1, 'the front answered')
  const writes = sent.writes
  for (let image = 0; image < 4; image++) write(frame, held, 6)
  assert.equal(sent.writes, writes, 'nothing sent again')
  frame.front = false
  write(frame, held, 6)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.front], 0, 'no front answered')
})

test('the reflections’ turn is the view’s, and an unchanged view sends nothing', () => {
  const { sent, write, held, frame } = stillView({ turn: 7 })
  write(frame, held, 6)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal], 7)
  const writes = sent.writes
  write(frame, held, 6)
  assert.equal(sent.writes, writes, 'the turn held: nothing sent')
})

test('a ray’s budget travels with the view: the reference’s steps by default, the settings’ otherwise', () => {
  const lanes = (extra: object) => {
    const { sent, write, held, frame } = stillView(extra)
    write(frame, held, 6)
    return [...sent.bits.slice(REFLECTION_VIEW_AT.scene, REFLECTION_VIEW_AT.scene + 4)]
  }
  // 50 iterations of the screen, 256 steps a ring: a step is four units of work and one triangle test.
  assert.deepEqual(lanes({}), [50, 1024, 256, 1])
  assert.deepEqual(lanes({ screenSteps: 20, ringSteps: 100 }), [20, 400, 100, 1])
  assert.deepEqual(lanes({ sceneTraces: false }), [50, 1024, 256, 0], 'the scene trace off')
  assert.equal(REFLECTION_RULES.reflectionScreenSteps.default, 50)
  assert.equal(reflectionRingWork(REFLECTION_RULES.reflectionRingSteps.default), 1024)
  assert.equal(reflectionRingTests(REFLECTION_RULES.reflectionRingSteps.default), 256)
})

test('the census reports the ring’s budget the rays were spent against, and the one the settings give', () => {
  const { device } = fakeDevice()
  const census = createReflectionCensus(device)
  census.copy(device.createCommandEncoder(), 1)
  assert.deepEqual(
    [census.metrics()?.proxyUnits, census.metrics()?.proxyTriangles],
    [1024, 256],
    'the defaults, before any image set a budget',
  )
  census.budget(400, 100)
  assert.deepEqual([census.metrics()?.proxyUnits, census.metrics()?.proxyTriangles], [400, 100])
  census.dispose()
})
