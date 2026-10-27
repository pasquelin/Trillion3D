// The reflection's view uniform, as each image writes it: the pixel scale, the geometry of a surface's
// thickness, the held image and whether the screen traces, what a ray may spend, written only when
// they changed, and nothing in them turning with the frame. The settings' reader and the census
// have their own file (`settings.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { heldImage } from './heldImage.fixture.ts'
import { viewDevice, stillView } from './viewWrite.fixture.ts'
import { screenRelativeThickness } from '../../visibility/hiz/gpu/screenSlab.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import { perspectiveProjection } from '../../../../math/src/projection/camera.ts'

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
  // The angle of a pixel at the eye: the arctangent of 2 · tan(half the HORIZONTAL field of view) over the image's height (the perspective has an aspect of 2,
  // its horizontal half-angle's tangent is twice the vertical one's), not the vertical field's over the height.
  assert.ok(
    Math.abs(
      words[REFLECTION_VIEW_AT.eyeSpread] - Math.atan((2 * 2 * Math.tan(Math.PI / 6)) / 300),
    ) < 1e-6,
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

test('an orthographic projection has no field of view: the angle a pixel spans at the eye is none', () => {
  const { device, buffer, held: sent } = viewDevice()
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
  createReflectionViewWriter(device, buffer)(
    { viewProjection: identity, size: [10, 4], depthDrawn: true, eye: [0, 0, 0] },
    heldImage(),
  )
  assert.equal(sent.words[REFLECTION_VIEW_AT.eyeSpread], 0)
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

test('the noise of the view turns with the engine’s frame index modulo eight, apart from the reflections’ turn', () => {
  const { sent, write, held, frame } = stillView({ turn: 3, frameIndex: 13 })
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal], 3, 'the turn')
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal + 1], 5, '13 modulo 8')
  frame.frameIndex = 16
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal + 1], 0)
})

test('the tile jitter turns with the engine’s frame index itself, not the period of the ray directions', () => {
  const { sent, write, held, frame } = stillView({ turn: 0, frameIndex: 13 })
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal], 0, 'the turn, held at its period')
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal + 2], 13, 'the frame index, unmasked')
  frame.frameIndex = 14
  write(frame, held)
  assert.equal(sent.bits[REFLECTION_VIEW_AT.temporal + 2], 14)
})
