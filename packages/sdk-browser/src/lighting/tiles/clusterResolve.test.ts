// #1249: the light grid lights a pixel exactly as develop. The tile pass's own binning
// (`clusterPartBits`, `clusterWord`, run lane by lane by `passMasks`) fills the record's slice masks
// from the walked slice — the list, its pool room past 64 lights, or every light —, then the
// shipped resolve (`clusterLighting`, `sliceLighting`, `beyondRange`) walks the pixel's slice. Its
// sum must equal the full walk's (`tileLighting`), and every lamp that reaches the pixel must be
// shaded. The world is the view axis plus a lateral offset the pass never sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { passMasks, sliceMap, type AxisLight } from './clusterSlices.fixture.ts';

const K = wgslConstants(DIRECT_LIGHTING_WGSL);
const NEAR = 0.1;
const f32 = (v: number) => Math.fround(v);
const bits = (v: number) => new DataView(Float32Array.of(v).buffer).getUint32(0);
const unbits = (u: number) => new DataView(Uint32Array.of(u).buffer).getFloat32(0);
const ctz = (x: number) => ((x >>>= 0) ? 31 - Math.clz32(x & -x) : 32);
type Lamp = AxisLight & { lateral: number; weight: number };
type Walk = 'list' | 'pool' | 'scene';

/** A tile record whose opaque slice keeps `kept` (ranks into `lamps`), walked as `walk` says, its
 *  depths at `front` and `back`, and its masks filled by the tile pass's binning. */
function tileRecord(lamps: Lamp[], kept: number[], walk: Walk, front: number, back: number) {
  const tiles = new Uint32Array(K.TILE_STRIDE + lamps.length);
  tiles[0] = kept.length;
  if (walk === 'list') tiles.set(kept, K.TILE_OPAQUE_BASE);
  if (walk === 'pool') tiles.set(kept, (tiles[K.TILE_OPAQUE_BASE] = K.TILE_STRIDE));
  if (walk === 'scene') tiles[K.TILE_OPAQUE_BASE] = K.TILE_NO_SLICE;
  const [nearZ, farZ] = [f32(NEAR / front), f32(NEAR / back)];
  tiles[K.TILE_DEPTH_BASE] = bits(nearZ);
  tiles[K.TILE_DEPTH_BASE + 1] = bits(farZ);
  // `clusterFrame`: the near plane's offset times the normalized depths.
  passMasks(tiles, 0, lamps, NEAR * (1 / nearZ), NEAR * (1 / farZ));
  return tiles;
}

/** The resolve of the record's one tile at a pixel of axis distance `axis` and offset `lateral`:
 *  the grid's sum, the full sum, and the lamps each shaded. */
function resolve(tiles: Uint32Array, lamps: Lamp[], axis: number, lateral: number) {
  const z = f32(NEAR / axis);
  const at = NEAR / z;
  const shaded: Lamp[] = [];
  const { clusterLighting, tileLighting } = shaderFunctions<{
    clusterLighting: (...args: unknown[]) => number;
    tileLighting: (...args: unknown[]) => number;
  }>(
    DIRECT_LIGHTING_WGSL.replaceAll('bitcast<f32>(', 'unbits('),
    [
      'clusterLighting',
      'clusterMask',
      'tileLighting',
      'tileSlice',
      'sliceLighting',
      'clusterSliceIndex',
      'clusterDistance',
      'clusterGroup',
      'beyondRange',
    ],
    {
      ...K,
      FULL_MASK: { x: 0xffffffff, y: 0xffffffff },
      log: Math.log,
      floor: Math.floor,
      length: Math.abs,
      abs: Math.abs,
      countTrailingZeros: ctz,
      unbits,
      depth: {},
      vec2i: (p: unknown) => p,
      vec3f: () => 0,
      textureLoad: () => z,
      tileLights: tiles,
      directLights: { count: lamps.length, items: lamps },
      declaredLight: (lamp: Lamp) => {
        const sun = Math.abs(lamp.params.x - K.KIND_SUN) < 0.5;
        const reach = Math.hypot(lamp.positionRange.xyz - at, lamp.lateral - lateral);
        if (!sun && reach >= lamp.positionRange.w) return 0;
        shaded.push(lamp);
        return lamp.weight;
      },
    },
  );
  const args = [0, 0, 0, 0, 0, at, 0] as const;
  const cluster = clusterLighting(...args, { x: 0, y: 0 }, 1, { x: 8, y: 8 });
  const clusterShaded = shaded.splice(0);
  const full = tileLighting(...args, { x: 0, y: 0 }, 1, 0, K.TILE_OPAQUE_BASE);
  return { cluster, full, clusterShaded, fullShaded: shaded, at };
}

/** `count` random lamps in and around the tile's depth range, one sun among them past 32. */
function lamps(r: () => number, count: number, front: number, back: number, wide = 1): Lamp[] {
  return [...Array(count).keys()].map((rank) => ({
    positionRange: {
      xyz: front * (back / front) ** (r() * 1.2 - 0.1),
      w: wide * r() * (back / front) ** (r() * 0.4),
    },
    params: { x: rank === 33 ? K.KIND_SUN : 0 },
    lateral: (r() - 0.5) * 4,
    weight: f32(0.5 + r()),
  }));
}

function check(scene: Lamp[], kept: number[], walk: Walk, front: number, back: number, r: () => number) {
  const tiles = tileRecord(scene, kept, walk, front, back);
  let walked = 0;
  for (let pixel = 0; pixel < 40; pixel++) {
    const run = resolve(tiles, scene, front * (back / front) ** r(), (r() - 0.5) * 4);
    assert.equal(run.cluster, run.full, `${walk} ${scene.length}: the grid's sum is the full one`);
    assert.deepEqual(run.clusterShaded, run.fullShaded, 'every lamp that reaches it, in rank order');
    walked += run.clusterShaded.length;
  }
  return walked;
}

test('a pixel lights exactly develop, for random lamp sets of 1 to 256, list, pool and scene', () => {
  for (const count of [1, 2, 4, 8, 16, 32, 64, 65, 100, 256]) {
    const r = random(count);
    const [front, back] = [0.5 + r(), 20 + 200 * r()];
    const scene = lamps(r, count, front, back);
    const kept = [...scene.keys()].filter(() => r() < 0.9);
    if (kept.length <= K.TILE_LIGHTS) check(scene, kept, 'list', front, back, r);
    else {
      check(scene, kept, 'pool', front, back, r);
      check(scene, kept, 'scene', front, back, r);
    }
  }
});

test('the edge cases: a lamp that reaches one point, a tile every lamp reaches', () => {
  const r = random(7);
  const [front, back] = [1, 100];
  // A lamp whose sphere just touches a pixel at a slice boundary, along the axis alone.
  const boundary = front * (back / front) ** (5 / 16);
  const touching: Lamp = {
    positionRange: { xyz: boundary + 3, w: 3 * (1 + 1e-6) },
    params: { x: 0 },
    lateral: 0,
    weight: 1,
  };
  const tiles = tileRecord([touching], [0], 'list', front, back);
  const run = resolve(tiles, [touching], boundary, 0);
  assert.deepEqual([run.cluster, run.clusterShaded.length], [1, 1], 'the touching lamp is shaded');
  // 256 lamps whose spheres cover the whole tile: every slice walks all of them.
  const all = lamps(r, 256, front, back).map((lamp) => ({ ...lamp, positionRange: { ...lamp.positionRange, w: 1e4 } }));
  const full = tileRecord(all, [...all.keys()], 'pool', front, back);
  for (let word = 0; word < 32; word++) assert.equal(full[K.TILE_CLUSTER_BASE + word], 0xffffffff);
  check(all, [...all.keys()], 'pool', front, back, r);
});

test('the grid walks fewer lamps than the tile list on a deep tile', () => {
  const r = random(11);
  const [front, back] = [0.5, 400];
  const scene = lamps(r, 200, front, back, 0.2);
  const tiles = tileRecord(scene, [...scene.keys()], 'pool', front, back);
  const { clusterSliceIndex } = sliceMap();
  const group = Math.ceil(scene.length / 64);
  const pixels = 200;
  let walked = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const slice = clusterSliceIndex(front * (back / front) ** r(), front, back);
    for (let bit = 0; bit < 64; bit++) {
      const word = tiles[K.TILE_CLUSTER_BASE + 2 * slice + (bit >> 5)];
      if ((word >>> (bit & 31)) & 1) walked += Math.max(0, Math.min(group, scene.length - bit * group));
    }
  }
  assert.ok(walked < (pixels * scene.length) / 2, `the grid walks ${walked} of ${pixels * scene.length}`);
});
