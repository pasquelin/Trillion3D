import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OBJECT_SHADOW_DEFAULTS,
  clampShadowResolution,
  makesTranslucentObjectShadow,
  shadowFadeAlpha,
} from './translucentShadowRules.ts'
import { objectShadowSize, translucentAtlasSide } from './objectShadowSize.ts'
import { objectShadowInitializer, setupObjectProjection } from './objectShadowSetup.ts'
import { packTranslucentShadows, sortByArea, writeShadowTile } from './transmissionAtlas.ts'
import {
  objectShadowHeldDrawn,
  objectShadowHoldKey,
  type ObjectShadowFrame,
} from './objectShadowFrame.ts'

const S = OBJECT_SHADOW_DEFAULTS
const bounds = {
  origin: [100, 50, 200] as [number, number, number],
  extent: [50, 20, 10] as [number, number, number],
  radius: 55,
}

test('the reference defaults: nothing is made until the project allows it', () => {
  assert.equal(S.projectEnabled, false)
  assert.equal(makesTranslucentObjectShadow(S), false)
  const on = { ...S, projectEnabled: true }
  assert.equal(makesTranslucentObjectShadow(on), true)
  assert.equal(makesTranslucentObjectShadow({ ...on, useDepths: false }), false)
  assert.equal(makesTranslucentObjectShadow({ ...on, perObject: false }), false)
})

test('the fade is 0 under the minimum, 1 over the fade side, and rises between', () => {
  assert.equal(shadowFadeAlpha(32, 64, 32, 0.25), 0)
  assert.equal(shadowFadeAlpha(65, 64, 32, 0.25), 1)
  const mid = shadowFadeAlpha(48, 64, 32, 0.25)
  assert.ok(mid > 0 && mid < 1)
  assert.ok(shadowFadeAlpha(40, 64, 32, 0.25) < mid)
})

test('the light scale raises before the clamp and lowers after it', () => {
  assert.equal(clampShadowResolution(1500, 2, 2040), 2040)
  assert.equal(clampShadowResolution(1500, 0.5, 2040), 750)
  assert.equal(clampShadowResolution(3000, 0.5, 2040), 1020)
})

test('a subject too small on screen makes no shadow, a large one a half-power rectangle shrunk for the translucent atlas', () => {
  const view = { origin: [0, 0, 0], screenScale: 1000, projectionScale: [1, 1] as [number, number] }
  const subject = { center: [1000, 0, 0], radius: 5 }
  assert.equal(objectShadowSize(S, subject, view, 1), null)
  const big = objectShadowSize(S, { center: [1000, 0, 0], radius: 500 }, view, 1)!
  // 1000 * 500 / 1000 = 500 px * 1.27324 = 636 texels: half of the power of two over it is 512; shrunk by 2.
  assert.equal(big.sizeX, 512)
  assert.equal(big.translucentX, 256)
  assert.equal(big.translucentMaxY, 1016)
  assert.equal(translucentAtlasSide(S), 1024)
  assert.equal(big.fade, 1)
})

test('a directional shadow looks along the light and fits the object in a rectangle', () => {
  const init = objectShadowInitializer({ kind: 'directional', direction: [0, 0, -1] }, bounds, S)!
  assert.deepEqual(init.preShadowTranslation, [-100, -50, -200])
  const p = setupObjectProjection(init, 128, 1000, 0.1, true)!
  assert.equal(p.resolutionX, 128)
  assert.ok(p.resolutionY >= 1 && p.resolutionY <= 1000)
  assert.equal(p.invMaxSubjectDepth, 1)
  // The object's depth range along the light is its extent along the light: 2 * 10 for a box seen from above.
  assert.ok(Math.abs(p.maxSubjectZ - p.minSubjectZ - 20) < 1e-6)
  // The box's corners project inside the inner clip rectangle.
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const v = [sx * 50, sy * 20, 0, 1]
      const m = p.translatedWorldToClipInner
      const x = v[0]! * m[0]! + v[1]! * m[4]! + v[2]! * m[8]! + m[12]!
      const y = v[0]! * m[1]! + v[1]! * m[5]! + v[2]! * m[9]! + m[13]!
      assert.ok(Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9)
    }
  // The long side of a 100 x 40 box fills the x axis: the aspect is 2.5.
  assert.equal(p.resolutionY, Math.trunc(128 / 2.5))
})

test('a local light behind the object gives a perspective frame; one inside is drawn back', () => {
  const far = objectShadowInitializer(
    { kind: 'local', position: [100, 50, 1200], radius: 3000 },
    bounds,
    S,
  )!
  assert.deepEqual(far.wAxis, [0, 0, 1, 0])
  const p = setupObjectProjection(far, 64, 512, 0.1, true)!
  assert.ok(p.minSubjectZ > 900 && p.maxSubjectZ > p.minSubjectZ)
  assert.ok(Math.abs(p.invMaxSubjectDepth - 1 / p.minSubjectZ) < 1e-12)
  const inside = objectShadowInitializer(
    { kind: 'local', position: bounds.origin, radius: 3000 },
    bounds,
    S,
  )
  assert.equal(inside, null)
  const near = objectShadowInitializer(
    { kind: 'local', position: [100, 50, 205], radius: 3000 },
    bounds,
    S,
  )!
  assert.ok(
    near.subject.origin[0] !== 0 || near.subject.origin[1] !== 0 || near.subject.origin[2] !== 0,
  )
  assert.ok(setupObjectProjection(near, 64, 512, 0.1, true) !== null)
})

test('an object behind a local light has no shadow', () => {
  const init = objectShadowInitializer(
    { kind: 'local', position: [100, 50, 1200], radius: 3000 },
    bounds,
    S,
  )!
  const behind = {
    ...init,
    subject: { ...init.subject, origin: [0, 0, 5000] as [number, number, number] },
  }
  assert.equal(setupObjectProjection(behind, 64, 512, 0.1, true), null)
})

test('the atlas packs the largest first, a new atlas where one is full', () => {
  const shadows = sortByArea([
    { resolutionX: 8, resolutionY: 8 },
    { resolutionX: 120, resolutionY: 120 },
    { resolutionX: 120, resolutionY: 120 },
    { resolutionX: 60, resolutionY: 120 },
  ])
  assert.equal(shadows[0]!.resolutionX, 120)
  const { slots, atlases } = packTranslucentShadows(shadows, 256)
  assert.equal(slots.length, 4)
  // Three 128 squares and a 68 x 128 do not fit a 256 atlas twice: 128 + 128 across, two rows of two at most.
  assert.equal(atlases, 1)
  assert.deepEqual(slots[0], { atlas: 0, x: 0, y: 0 })
  const rects = slots.map((s, i) => ({
    s: s!,
    w: shadows[i]!.resolutionX + 8,
    h: shadows[i]!.resolutionY + 8,
  }))
  for (const a of rects)
    for (const b of rects)
      if (a !== b && a.s.atlas === b.s.atlas)
        assert.ok(
          a.s.x + a.w <= b.s.x ||
            b.s.x + b.w <= a.s.x ||
            a.s.y + a.h <= b.s.y ||
            b.s.y + b.h <= a.s.y,
        )
  const two = packTranslucentShadows(
    [
      { resolutionX: 200, resolutionY: 200 },
      { resolutionX: 200, resolutionY: 200 },
    ],
    256,
  )
  assert.equal(two.atlases, 2)
  assert.equal(packTranslucentShadows([{ resolutionX: 300, resolutionY: 10 }], 256).slots[0], null)
})

test('a rectangle in its atlas maps to a half size, a centre and an interior that reaches one border past its far side', () => {
  const out = new Float32Array(8)
  writeShadowTile(out, 0, 4, { resolutionX: 64, resolutionY: 32, border: 4 }, { x: 8, y: 16 }, 256)
  assert.deepEqual(
    [...out.slice(0, 4)],
    [32 / 256, 16 / 256, 12 / 256 + 32 / 256, 20 / 256 + 16 / 256],
  )
  assert.deepEqual([...out.slice(4, 8)], [12 / 256, 20 / 256, 80 / 256, 56 / 256])
})

test('the hold key moves with the pairs the subjects are, their slots and sizes, the settings and whether the atlases were drawn, and is a tuple compared whole', () => {
  const hold = { tuple: [] as number[], epoch: 0 }
  const frame = (
    drawn: boolean,
    ids: [number, number][],
    { x = 0, resolution = 64, fade = 1, maxResolution = 2048 } = {},
  ) =>
    ({
      drawn,
      hold,
      settings: { maxResolution, perObject: true },
      subjects: ids.map(([lightId, primitiveId]) => ({
        lightId,
        primitiveId,
        place: 0,
        fade,
        projection: {
          resolutionX: resolution,
          resolutionY: resolution,
          border: 4,
          maxScreenPercent: 1,
          invMaxSubjectDepth: 1,
          fadeStart: 0,
          invFadeLength: 0,
          minSubjectZ: 0,
          maxSubjectZ: 1,
          directional: true,
          translatedWorldToClipInner: new Float64Array(16),
          preShadowTranslation: [0, 0, 0],
        },
      })),
      atlases: { slots: ids.map(() => ({ atlas: 0, x, y: 0 })), atlases: [{ side: 256 }] },
    }) as unknown as ObjectShadowFrame
  const base = objectShadowHoldKey(frame(true, [[1, 2]]))
  assert.equal(objectShadowHoldKey(frame(true, [[1, 2]])), base, 'the same tuple holds')
  const moved = (f: ObjectShadowFrame) => {
    const before = objectShadowHoldKey(frame(true, [[1, 2]]))
    const after = objectShadowHoldKey(f)
    assert.notEqual(after, before)
    return after
  }
  moved(frame(false, [[1, 2]]))
  moved(frame(true, [[1, 3]]))
  moved(
    frame(true, [
      [1, 2],
      [4, 5],
    ]),
  )
  moved(frame(true, [[1, 2]], { x: 8 }))
  moved(frame(true, [[1, 2]], { resolution: 128 }))
  moved(frame(true, [[1, 2]], { fade: 0.5 }))
  moved(frame(true, [[1, 2]], { maxResolution: 1024 }))
  // Asked without touching the hold: the drawn tuple is the one kept, another pair is another, and the epoch never moves by the question.
  const epoch = objectShadowHoldKey(frame(true, [[1, 2]]))
  assert.equal(objectShadowHeldDrawn(frame(true, [[1, 3]])), false)
  assert.equal(objectShadowHeldDrawn(frame(true, [[1, 2]])), true)
  assert.equal(objectShadowHoldKey(frame(true, [[1, 2]])), epoch)
})
