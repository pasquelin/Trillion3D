// The projection shader data as the shaders read it: each field the host writes sits at the offset
// the WGSL struct `VsmProjectionRecord` gives it, and the record is the struct's size.
import { LIGHT_KIND } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_COARSE,
  VSM_MAP_UNCACHED,
  VSM_PROJECTION_RECORD_BYTES,
} from '../constants.ts'
import {
  vsmShadowMatrices,
  vsmDefaultProjectionData,
  writeVsmProjectionData,
} from './projectionData.ts'
import { VSM_PROJECTION_DATA_WGSL, VSM_PROJECTION_RECORD_WGSL } from './projectionDataWgsl.ts'
import { wgslStructLayout } from '../wgslStructLayout.fixture.ts'

/** Three flags apart from each other (bits 0, 2 and 4), so a word written shifted or merged shows. */
const FLAGS = VSM_MAP_UNCACHED | VSM_MAP_COARSE | VSM_MAP_COARSE_KEEPS_DYNAMIC

/** A matrix whose every float says where it is: `base + index`. */
const counting = (base: number) => Float64Array.from({ length: 16 }, (_, k) => base + k)

/** The byte offset of each field of `VsmProjectionRecord`, and its size, by WGSL's layout rules. */
const rawOffsets = () => wgslStructLayout(VSM_PROJECTION_DATA_WGSL, 'VsmProjectionRecord')

test('a record is the shader struct: its size', () => {
  assert.equal(VSM_PROJECTION_RECORD_BYTES, rawOffsets().size)
})

/** The offsets the lighting shader reads, as numbers: each field of the struct and its byte
 *  offset. */
const PINNED_OFFSETS: readonly (readonly [string, number])[] = [
  ['lightKind', 0],
  ['emitterSize', 4],
  ['finestMip', 8],
  ['mapLevel', 12],
  ['lightViewToClip', 16],
  ['lightDirection', 80],
  ['levelsLeft', 92],
  ['planesToMapUv', 96],
  ['shiftedToMapUv', 160],
  ['originShiftHigh', 224],
  ['flags', 236],
  ['originShiftLow', 240],
  ['levelBias', 252],
  ['clipmapOrigin', 256],
  ['ditherTexels', 268],
  ['cornerSteps', 272],
  ['lightRange', 280],
  ['tableOrigin', 284],
  ['wpoThreshold', 288],
  // The occlusion's previous view, which the shadow raster's first cull reads: the lighting reads
  // none of it, the offsets before it are unmoved.
  ['prevMapId', 292],
  ['prevTableOrigin', 296],
  ['prevShiftedToClip', 304],
  ['prevClipDepth', 368],
  ['prevFinestMip', 384],
  // The place of the map's view among the views drawn: the bit of its per-view instance state.
  ['viewSlot', 388],
  // The clip depths a non-static caster must lie within to be drawn into the map.
  ['dynamicDepthCullRange', 392],
]

/** Throws unless the struct of `text` has the offsets the lighting shader reads, as numbers: no
 *  field more or fewer, each at its pinned offset, and the pinned size. */
function assertPinnedOffsets(text: string) {
  const { offsets, size } = wgslStructLayout(text, 'VsmProjectionRecord')
  assert.equal(
    Object.keys(offsets).length,
    PINNED_OFFSETS.length,
    'the struct has the pinned fields',
  )
  for (const [field, offset] of PINNED_OFFSETS) assert.equal(offsets[field], offset, field)
  assert.equal(size, 400)
}

test('the offsets the lighting shader reads are pinned, as numbers, not derived from the record size', () => {
  // A field moved in the struct, with the size constant and the writer moving with it, must still
  // fail here: the lighting shader reads the record by these offsets.
  assertPinnedOffsets(VSM_PROJECTION_RECORD_WGSL.text)
  assert.equal(VSM_PROJECTION_RECORD_BYTES, 400)
})

test('the pin fails when a field is added, removed or moved', () => {
  const text = VSM_PROJECTION_RECORD_WGSL.text
  assert.throws(() =>
    assertPinnedOffsets(text.replace(' lightKind:u32,', ' lightKind:u32,\n extra:u32,')),
  )
  assert.throws(() => assertPinnedOffsets(text.replace(' finestMip:u32,\n', '')))
  assert.throws(() =>
    assertPinnedOffsets(
      text.replace(
        ' cornerSteps:vec2i,\n lightRange:f32,',
        ' lightRange:f32,\n cornerSteps:vec2i,',
      ),
    ),
  )
  assert.throws(() =>
    assertPinnedOffsets(text.replace('cornerSteps:vec2i', 'cornerSteps:vec2u,\n pad2:u32')),
  )
})

test('the writer puts every field of a map at its id, at the struct offset, and nothing beside it', () => {
  const R = VSM_PROJECTION_RECORD_BYTES,
    { offsets: o } = rawOffsets()
  const buffer = new ArrayBuffer(4 * R)
  new Uint8Array(buffer).fill(0xab)
  const translation = [12345.678901, -0.000123, 4096.5]
  writeVsmProjectionData(buffer, 2, {
    lightViewToClip: counting(100),
    shiftedToClip: counting(600),
    shiftedToMapUv: counting(200),
    planesToMapUv: counting(400),
    lightDirection: [0.25, -0.5, 0.75],
    lightKind: LIGHT_KIND.spot,
    originShift: translation,
    lightRange: 7.5,
    levelBias: 1.25,
    clipmapOrigin: [1, 2, 3],
    emitterSize: 0.5,
    cornerSteps: [-3, 4],
    mapLevel: -2,
    levelsLeft: -1,
    flags: FLAGS,
    ditherTexels: 2,
    finestMip: 3,
    tableOrigin: 7 | (9 << 16),
    wpoThreshold: 625,
    prevMapId: -1,
    prevTableOrigin: 5 | (6 << 16),
    prevFinestMip: 2,
    prevShiftedToClip: counting(800),
    prevClipDepth: [0.5, -0.25, 1],
    viewSlot: 3,
    dynamicDepthCullRange: [0.25, 4096],
  })
  const at = 2 * R,
    view = new DataView(buffer, at, R),
    f = (offset: number) => view.getFloat32(offset, true),
    u = (offset: number) => view.getUint32(offset, true),
    i = (offset: number) => view.getInt32(offset, true)
  for (const [offset, base] of [
    [o.lightViewToClip, 100],
    [o.shiftedToMapUv, 200],
    [o.planesToMapUv, 400],
  ])
    for (let k = 0; k < 16; k++) assert.equal(f(offset + 4 * k), base + k)
  const vec3 = (offset: number) => [f(offset), f(offset + 4), f(offset + 8)]
  assert.deepEqual(vec3(o.lightDirection), [0.25, -0.5, 0.75])
  assert.equal(u(o.lightKind), LIGHT_KIND.spot)
  for (let a = 0; a < 3; a++) {
    // High is the f32 of the double, low the f32 of what it missed: their sum is the double.
    const high = f(o.originShiftHigh + 4 * a),
      low = f(o.originShiftLow + 4 * a)
    assert.equal(high, Math.fround(translation[a]))
    assert.ok(Math.abs(high + low - translation[a]) < 1e-9, `axis ${a}`)
  }
  assert.deepEqual([f(o.lightRange), f(o.levelBias), f(o.emitterSize)], [7.5, 1.25, 0.5])
  assert.deepEqual(vec3(o.clipmapOrigin), [1, 2, 3])
  const corner = o.cornerSteps
  assert.deepEqual([i(corner), i(corner + 4)], [-3, 4])
  assert.deepEqual([i(o.mapLevel), u(o.flags)], [-2, FLAGS])
  assert.deepEqual([f(o.ditherTexels), u(o.finestMip)], [2, 3])
  assert.equal(i(o.levelsLeft), -1)
  // The page table's origin, two halves, and the offset distance squared, which close the record.
  assert.equal(u(o.tableOrigin), 7 | (9 << 16))
  assert.equal(f(o.wpoThreshold), 625)
  // The occlusion's previous view: no previous map is the all-ones id.
  assert.deepEqual(
    [u(o.prevMapId), u(o.prevTableOrigin), u(o.prevFinestMip)],
    [0xffffffff, 5 | (6 << 16), 2],
  )
  for (let k = 0; k < 16; k++) assert.equal(f(o.prevShiftedToClip + 4 * k), 800 + k)
  assert.deepEqual(vec3(o.prevClipDepth), [0.5, -0.25, 1])
  assert.equal(u(o.viewSlot), 3)
  assert.deepEqual([f(o.dynamicDepthCullRange), f(o.dynamicDepthCullRange + 4)], [0.25, 4096])
  const bytes = new Uint8Array(buffer)
  assert.ok(
    bytes.subarray(0, at).every((b) => b === 0xab),
    'the maps before are untouched',
  )
  assert.ok(
    bytes.subarray(at + R).every((b) => b === 0xab),
    'the map after too',
  )
})

test('the defaults of a record', () => {
  const d = vsmDefaultProjectionData()
  assert.deepEqual([d.flags, d.finestMip, d.mapLevel, d.levelsLeft], [0, 0, 0, 0])
  assert.deepEqual(d.dynamicDepthCullRange, [0, FLOAT32_MAX], 'no limit')
})

test('the shadow UV matrix maps clip space to UV, y down', () => {
  const identity = Float64Array.from({ length: 16 }, (_, k) => (k % 5 === 0 ? 1 : 0))
  const matrices = {
    shiftedToClip: new Float64Array(16),
    shiftedToMapUv: new Float64Array(16),
    planesToMapUv: new Float64Array(16),
  }
  vsmShadowMatrices(matrices, identity, identity)
  const uv = matrices.shiftedToMapUv
  const apply = (x: number, y: number, z: number) => [
    uv[0] * x + uv[4] * y + uv[8] * z + uv[12],
    uv[1] * x + uv[5] * y + uv[9] * z + uv[13],
    uv[2] * x + uv[6] * y + uv[10] * z + uv[14],
  ]
  assert.deepEqual(apply(-1, 1, 0.25), [0, 0, 0.25], 'top left')
  assert.deepEqual(apply(1, -1, 0.75), [1, 1, 0.75], 'bottom right')
})
