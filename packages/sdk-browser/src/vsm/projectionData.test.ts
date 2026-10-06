// The projection shader data as the shaders read it: each field the host writes sits at the offset
// the WGSL struct `VsmProjectionRecord` gives it, and the record is the struct's size.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VSM_LIGHT_KIND_SPOT,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_COARSE,
  VSM_MAP_UNCACHED,
  VSM_PROJECTION_RECORD_BYTES,
} from './constants.ts';
import {
  vsmShadowUvMatrix,
  vsmDefaultProjectionData,
  writeVsmProjectionData,
} from './projectionData.ts';
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts';
import { wgslStructLayout } from './wgslStructLayout.fixture.ts';

/** Three flags apart from each other (bits 0, 2 and 4), so a word written shifted or merged shows. */
const FLAGS = VSM_MAP_UNCACHED | VSM_MAP_COARSE | VSM_MAP_COARSE_KEEPS_DYNAMIC;

/** A matrix whose every float says where it is: `base + index`. */
const counting = (base: number) => Float64Array.from({ length: 16 }, (_, k) => base + k);

/** The byte offset of each field of `VsmProjectionRecord`, and its size, by WGSL's layout rules. */
const rawOffsets = () => wgslStructLayout(VSM_PROJECTION_DATA_WGSL, 'VsmProjectionRecord');

test('a record is the shader struct: its size', () => {
  assert.equal(VSM_PROJECTION_RECORD_BYTES, rawOffsets().size);
});

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
];

/** Throws unless the struct of `text` has the offsets the lighting shader reads, as numbers: no
 *  field more or fewer, each at its pinned offset, and the pinned size. */
function assertPinnedOffsets(text: string) {
  const { offsets, size } = wgslStructLayout(text, 'VsmProjectionRecord');
  assert.equal(
    Object.keys(offsets).length,
    PINNED_OFFSETS.length,
    'the struct has the pinned fields',
  );
  for (const [field, offset] of PINNED_OFFSETS) assert.equal(offsets[field], offset, field);
  assert.equal(size, 288);
}

test('the offsets the lighting shader reads are pinned, as numbers, not derived from the record size', () => {
  // A field moved in the struct, with the size constant and the writer moving with it, must still
  // fail here: the lighting shader reads the record by these offsets.
  assertPinnedOffsets(VSM_PROJECTION_DATA_WGSL);
  assert.equal(VSM_PROJECTION_RECORD_BYTES, 288);
});

test('the pin fails when a field is added, removed or moved', () => {
  const text = VSM_PROJECTION_DATA_WGSL;
  assert.throws(() =>
    assertPinnedOffsets(text.replace(' lightKind:u32,', ' lightKind:u32,\n extra:u32,')),
  );
  assert.throws(() => assertPinnedOffsets(text.replace(' finestMip:u32,\n', '')));
  assert.throws(() =>
    assertPinnedOffsets(
      text.replace(
        ' cornerSteps:vec2i,\n lightRange:f32,',
        ' lightRange:f32,\n cornerSteps:vec2i,',
      ),
    ),
  );
  assert.throws(() =>
    assertPinnedOffsets(text.replace('cornerSteps:vec2i', 'cornerSteps:vec2u,\n pad2:u32')),
  );
});

test('the writer puts every field of a map at its id, at the struct offset, and nothing beside it', () => {
  const R = VSM_PROJECTION_RECORD_BYTES,
    { offsets: o } = rawOffsets();
  const buffer = new ArrayBuffer(4 * R);
  new Uint8Array(buffer).fill(0xab);
  const translation = [12345.678901, -0.000123, 4096.5];
  writeVsmProjectionData(buffer, 2, {
    lightViewToClip: counting(100),
    shiftedToMapUv: counting(200),
    planesToMapUv: counting(400),
    lightDirection: [0.25, -0.5, 0.75],
    lightKind: VSM_LIGHT_KIND_SPOT,
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
  });
  const at = 2 * R,
    view = new DataView(buffer, at, R),
    f = (offset: number) => view.getFloat32(offset, true),
    u = (offset: number) => view.getUint32(offset, true),
    i = (offset: number) => view.getInt32(offset, true);
  for (const [offset, base] of [
    [o.lightViewToClip, 100],
    [o.shiftedToMapUv, 200],
    [o.planesToMapUv, 400],
  ])
    for (let k = 0; k < 16; k++) assert.equal(f(offset + 4 * k), base + k);
  const vec3 = (offset: number) => [f(offset), f(offset + 4), f(offset + 8)];
  assert.deepEqual(vec3(o.lightDirection), [0.25, -0.5, 0.75]);
  assert.equal(u(o.lightKind), VSM_LIGHT_KIND_SPOT);
  for (let a = 0; a < 3; a++) {
    // High is the f32 of the double, low the f32 of what it missed: their sum is the double.
    const high = f(o.originShiftHigh + 4 * a),
      low = f(o.originShiftLow + 4 * a);
    assert.equal(high, Math.fround(translation[a]));
    assert.ok(Math.abs(high + low - translation[a]) < 1e-9, `axis ${a}`);
  }
  assert.deepEqual([f(o.lightRange), f(o.levelBias), f(o.emitterSize)], [7.5, 1.25, 0.5]);
  assert.deepEqual(vec3(o.clipmapOrigin), [1, 2, 3]);
  const corner = o.cornerSteps;
  assert.deepEqual([i(corner), i(corner + 4)], [-3, 4]);
  assert.deepEqual([i(o.mapLevel), u(o.flags)], [-2, FLAGS]);
  assert.deepEqual([f(o.ditherTexels), u(o.finestMip)], [2, 3]);
  assert.equal(i(o.levelsLeft), -1);
  // The word past the last field, up to the record's 16-byte end, is zero.
  assert.equal(u(284), 0);
  const bytes = new Uint8Array(buffer);
  assert.ok(
    bytes.subarray(0, at).every((b) => b === 0xab),
    'the maps before are untouched',
  );
  assert.ok(
    bytes.subarray(at + R).every((b) => b === 0xab),
    'the map after too',
  );
});

test('the defaults of a record', () => {
  const d = vsmDefaultProjectionData();
  assert.deepEqual([d.flags, d.finestMip, d.mapLevel, d.levelsLeft], [0, 0, 0, 0]);
});

test('the shadow UV matrix maps clip space to UV, y down', () => {
  const identity = Float64Array.from({ length: 16 }, (_, k) => (k % 5 === 0 ? 1 : 0));
  const uv = vsmShadowUvMatrix(new Float64Array(16), identity, identity);
  const apply = (x: number, y: number, z: number) => [
    uv[0] * x + uv[4] * y + uv[8] * z + uv[12],
    uv[1] * x + uv[5] * y + uv[9] * z + uv[13],
    uv[2] * x + uv[6] * y + uv[10] * z + uv[14],
  ];
  assert.deepEqual(apply(-1, 1, 0.25), [0, 0, 0.25], 'top left');
  assert.deepEqual(apply(1, -1, 0.75), [1, 1, 0.75], 'bottom right');
});
