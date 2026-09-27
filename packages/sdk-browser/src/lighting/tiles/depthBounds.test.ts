import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { LIGHT_TILES_SHADER, lightTilesShader } from './shader.ts';

// #924 (OMB-03): where the device grants `subgroups`, each subgroup reduces the tile's depth
// bounds before one atomic per word. The four words the tile's bounds are built from must be
// those of the per-thread atomics, to the bit, whatever the subgroup size and the depths —
// including NaN, ±0, +Inf, subnormals and threads outside the image. Both variants are ported
// here statement by statement, WGSL's comparisons included (any comparison with NaN is false).

const LANES = LIGHT_SETTINGS.tileSize ** 2;
const word = new Float32Array(1),
  bits = new Uint32Array(word.buffer);
const bitsOf = (z: number) => ((word[0] = z), bits[0]);
type Lane = { z: number; inside: boolean };

/** `ATOMIC_DEPTH_BOUNDS`: every thread its own atomics. */
function atomicBounds(lanes: Lane[]) {
  const out = { nearest: 0, farthest: 0xffffffff, covered: 0, skyward: 0 };
  for (const { z, inside } of lanes) {
    if (!inside) continue;
    if (z > 0) {
      out.nearest = Math.max(out.nearest, bitsOf(z));
      out.farthest = Math.min(out.farthest, bitsOf(z));
      out.covered = 1;
    } else out.skyward = 1;
  }
  return out;
}

/** `SUBGROUP_DEPTH_BOUNDS`: each subgroup of `size` lanes reduces, its elected lane stores. */
function subgroupBounds(lanes: Lane[], size: number) {
  const out = { nearest: 0, farthest: 0xffffffff, covered: 0, skyward: 0 };
  for (let first = 0; first < lanes.length; first += size) {
    const group = lanes.slice(first, first + size);
    const lit = group.map(({ z, inside }) => inside && z > 0);
    const near = Math.max(...group.map(({ z }, i) => (lit[i] ? bitsOf(z) : 0)));
    const far = Math.min(...group.map(({ z }, i) => (lit[i] ? bitsOf(z) : 0xffffffff)));
    const anyLit = lit.some(Boolean),
      anySky = group.some(({ inside }, i) => inside && !lit[i]);
    if (anyLit) {
      out.nearest = Math.max(out.nearest, near);
      out.farthest = Math.min(out.farthest, far);
      out.covered = 1;
    }
    if (anySky) out.skyward = 1;
  }
  return out;
}

const SPECIAL = [NaN, 0, -0, Infinity, -Infinity, 1, 1e-45, 1.1754942e-38, 0.5, 1e-6];

test('subgroup depth bounds write the words of the per-thread atomics, any subgroup size', () => {
  const r = mulberry32(924);
  for (let run = 0; run < 400; run++) {
    const special = r() < 0.5,
      cut = Math.floor(r() * LANES) + 1;
    const lanes = [...Array(LANES).keys()].map((i) => ({
      z: Math.fround(special && r() < 0.3 ? SPECIAL[Math.floor(r() * SPECIAL.length)] : r()),
      inside: i < cut || r() < 0.5,
    }));
    const expected = atomicBounds(lanes);
    for (const size of [4, 8, 16, 32, 64, 128])
      assert.deepEqual(subgroupBounds(lanes, size), expected, `run ${run}, subgroup ${size}`);
  }
});

test('edge tiles: all outside, all sky, all NaN, one lit lane', () => {
  const cases: Lane[][] = [
    Array.from({ length: LANES }, () => ({ z: 0.5, inside: false })),
    Array.from({ length: LANES }, () => ({ z: 0, inside: true })),
    Array.from({ length: LANES }, () => ({ z: NaN, inside: true })),
    Array.from({ length: LANES }, (_, i) => ({ z: i === 77 ? 0.25 : -0, inside: true })),
  ];
  for (const lanes of cases)
    for (const size of [4, 32, 128])
      assert.deepEqual(subgroupBounds(lanes, size), atomicBounds(lanes));
});

test('the subgroup variant enables the extension; the plain pass asks for nothing', () => {
  const subgroups = lightTilesShader(true);
  assert.ok(subgroups.startsWith('enable subgroups;'));
  assert.match(subgroups, /subgroupMax\(select\(0u,bitcast<u32>\(z\),lit\)\)/);
  assert.doesNotMatch(LIGHT_TILES_SHADER, /subgroup/);
  assert.match(LIGHT_TILES_SHADER, /atomicMax\(&nearest,bitcast<u32>\(z\)\);/);
  // Past the depth bounds, the two passes are the same text.
  const tail = (code: string) => {
    const at = code.indexOf(' workgroupBarrier();\n if(lane==0u){');
    assert.ok(at > 0);
    return code.slice(at);
  };
  assert.equal(tail(subgroups), tail(LIGHT_TILES_SHADER));
});
