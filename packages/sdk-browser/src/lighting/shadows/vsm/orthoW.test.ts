// The marking of a sun's page leaves out the divide by w (`markingWgsl.ts`, `vsmMarkPage`): every
// clipmap level's shifted-to-UV matrix has the w row (0, 0, 0, 1), exactly, as uploaded
// in f32, so w = 0·x + 0·y + 0·z + 1 = 1 for a finite point and xyz / w are xyz, bit for bit; a
// point that is not finite has w NaN either way, which the overlap test rejects. A lamp's
// perspective projection keeps its divide.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { createVsmClipmap } from './clipmap.ts'
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import { projectionKit } from './projection/projectionKit.fixture.ts'
import { orthographicProjection } from '../../../../../math/src/projection/camera.ts'
import { vsmLayout } from './layout.ts'
import { mapsOf } from './clipmap.fixture.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'

const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0]
const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test("every clipmap level's UV matrix has the w row (0, 0, 0, 1), exactly in f32", () => {
  let levels = 0
  for (const direction of [
    [0.3, -0.9, 0.2],
    [0, -1, 0],
    [0.577, -0.577, 0.577],
    [-0.01, -0.2, 0.98],
  ])
    for (const eye of [
      [0, 2, 0],
      [1234.5, 87.25, -9876.125],
      [-3e4, 500, 2e4],
    ]) {
      const clipmap = createVsmClipmap(
        new VsmCacheManager(),
        { id: 'sun', direction },
        { view: VIEW, projection: PROJECTION, perspective: true, eye },
        { width: 1024, height: 1024 },
      )
      for (const { projectionData } of clipmap.cacheEntry.mapCaches) {
        const m = Float32Array.from(projectionData.shiftedToMapUv)
        assert.deepEqual([m[3], m[7], m[11], m[15]].map(Math.abs), [0, 0, 0, 1])
        levels++
      }
    }
  assert.ok(levels >= 12 * 17, `${levels} levels`)
})

test('only the sun marks without the divide: a lamp keeps it', () => {
  const code = vsmPixelPageMarkingWgsl(vsmLayout({ coverMode: 'suns', fullMapCapacity: 63 }))
  assert.match(
    functionsOf(code, ['vsmMarkPage']),
    /if\(!ortho\)\{mapUvz=vec4f\(perspectiveDivide\(mapUvz\),mapUvz\.w\);\}/,
  )
  assert.match(functionsOf(code, ['vsmMarkPageDirectional']), /marginOffset,true\);/)
  assert.match(functionsOf(code, ['vsmMarkPageLocal']), /marginOffset,false\);/)
})

test('the camera kind decides the projection path: an orthographic matrix scaled ×0.25 stays one', () => {
  // A homogeneous matrix scaled is the same projection; its M[3][3] is 0.25 then, under the old
  // threshold's 0.5. The view uniform's isOrtho word (u32 71) follows the camera's kind alone.
  const ortho = orthographicProjection(new Float64Array(16), -10, 10, -10, 10, 0.1, 100)
  const scaled = ortho.map((v) => v * 0.25)
  // The view uniform the projection pass uploads for its dispatch, read back from the queue.
  const word = (perspective: boolean) => {
    const kit = projectionKit()
    // The passes' recorded commands are not read: only the upload.
    kit.project([], {
      width: 64,
      height: 64,
      frameIndex: 0,
      camera: { view: VIEW, projection: scaled, perspective },
    })
    const write = kit.upload()!
    const bytes = write.data as Uint8Array
    return new Uint32Array(bytes.buffer, bytes.byteOffset, 72)[71]
  }
  assert.equal(word(false), 1, 'orthographic')
  assert.equal(word(true), 0, 'perspective')
  const level = (perspective: boolean) =>
    createVsmClipmap(
      new VsmCacheManager(),
      { id: 'sun', direction: [0, -1, 0] },
      { view: VIEW, projection: scaled, perspective, eye: [0, 0, 0] },
      { width: 64, height: 64 },
    ).cacheEntry.mapCaches[0].projectionData.shiftedToMapUv
  assert.notDeepEqual(level(false), level(true), 'the clipmap sizes its levels by the kind')
})

/** An orthographic view 10 m to each side, 50 m up the z axis looking down it, as the clipmap reads it. */
const orthoView = (more: object = {}) => ({
  view: VIEW,
  projection: orthographicProjection(new Float64Array(16), -10, 10, -10, 10, 0.1, 100),
  perspective: false,
  eye: [0, 0, 50],
  ...more,
})
const orthoClipmap = (camera: object, changes: Parameters<typeof mapsOf>[0] = {}) =>
  createVsmClipmap(
    new VsmCacheManager(),
    { id: 'sun', direction: [0.3, -0.9, 0.2] },
    camera as Parameters<typeof createVsmClipmap>[2],
    { width: 64, height: 64 },
    mapsOf(changes),
  )

test("an orthographic view's first level follows its box, then the bias: never below level 0", () => {
  // 10 m is 1000 cm: floor(log2(1000)) = 9 over the default first level 6.
  const first = (changes: Parameters<typeof mapsOf>[0]) =>
    orthoClipmap(orthoView(), changes).firstLevel
  assert.equal(first({}), 9)
  assert.equal(first({ shadowOrthoClipmapLodBias: 2 }), 11)
  assert.equal(first({ shadowOrthoClipmapLodBias: -30 }), 0)
  assert.equal(
    first({ shadowOrthoEstimateClipmapLevels: false }),
    6,
    'the estimate off: the setting',
  )
  assert.equal(
    first({ shadowOrthoEstimateClipmapLevels: false, shadowOrthoClipmapLodBias: 2 }),
    6,
    'the bias belongs to the estimate',
  )
})

test("an orthographic view's resolution bias takes a projection scale of 1, whatever its width", () => {
  // Width: its 10 m box doubled in centimetres, 2000 px; 0.5 level-0 texels over 16384 / 2000 of them.
  const expected = Math.log2((0.5 * 16384) / 2000)
  // The setting's bias for a sun at rest is added to it (`InterpolateResolutionBias`) and the sum held
  // to 0 or more: with the setting at 0 the bias is the screen's alone, with the default's -1.5 it is
  // lower by that.
  const none = {
    shadowResolutionLodBiasDirectional: 0,
    shadowResolutionLodBiasDirectionalMoving: 0,
  }
  assert.ok(Math.abs(orthoClipmap(orthoView(), none).levelBias - expected) < 1e-5)
  const rested = VSM_DEFAULT_SHADOWS.shadowResolutionLodBiasDirectional
  assert.ok(Math.abs(orthoClipmap(orthoView()).levelBias - Math.max(0, expected + rested)) < 1e-5)
})

test("a view's clipmaps are centred on the eye moved by its target, which a cast of its line of sight gives too", () => {
  const origin = (camera: object) => [...orthoClipmap(camera).originWorld]
  const target = orthoView({ viewTarget: [0, 0, -50] })
  assert.deepEqual(origin(target), [0, 0, 0], 'the view target')
  assert.deepEqual(
    origin(orthoView({ viewTarget: [0, 0, -30] })),
    [0, 0, 20],
    'the offset the cast resolved: 30 m along the view',
  )
  assert.deepEqual(origin(orthoView()), [0, 0, 50], 'none: the eye')
})
