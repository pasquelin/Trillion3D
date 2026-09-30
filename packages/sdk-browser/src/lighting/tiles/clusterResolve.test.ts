// #1249: the shipped cluster resolve sums develop's exact result. For random lamp sets the pixel
// walks only its log-Z slice — a subsequence of the tile's opaque list —, so every light that
// reaches the pixel is shaded and every one it drops contributes exactly zero. `clusterLighting`
// and `tileLighting` run here as JavaScript on a record the tile pass's binning fills; a lamp at or
// past its range is a stub `declaredLight` of zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { clusterSliceIndexWgsl, CLUSTER_SLICES } from './clusterWgsl.ts';

const K = wgslConstants(DIRECT_LIGHTING_WGSL);
const f32 = (v: number) => Math.fround(v);
const bits = (v: number) => new DataView(Float32Array.of(v).buffer).getUint32(0);
const unbits = (u: number) => new DataView(Uint32Array.of(u).buffer).getFloat32(0);
type Light = { axis: number; radius: number; weight: number };

/** A record whose opaque list holds every lamp (rank 0..N-1) and whose cluster descriptors are the
 *  bins of `mapping`, with the tile's depths at `front` and `back` (near-plane `nearPlane`). */
function record(
  lights: Light[],
  front: number,
  back: number,
  nearPlane: number,
  clustered: boolean,
) {
  const map = shaderFunctions<{
    clusterSliceSpan: (
      d: number,
      r: number,
      front: number,
      back: number,
    ) => { x: number; y: number };
  }>(clusterSliceIndexWgsl, ['clusterSliceSpan', 'clusterSliceIndex'], {
    CLUSTER_SLICES,
    log: Math.log,
    floor: Math.floor,
  });
  const spans = lights.map((light) => map.clusterSliceSpan(light.axis, light.radius, front, back));
  const bins = [...Array(CLUSTER_SLICES).keys()].map((slice) =>
    lights.flatMap((_, rank) => (slice >= spans[rank].x && slice < spans[rank].y ? [rank] : [])),
  );
  const pool = bins.flat();
  const words = new Uint32Array(K.TILE_STRIDE + pool.length);
  words[0] = lights.length;
  if (!clustered) {
    // Past its list, the tile names no slice and the resolve walks every declared light.
    words[K.TILE_OPAQUE_BASE] = K.TILE_NO_SLICE;
    return words;
  }
  words.set([...lights.keys()].slice(0, K.TILE_LIGHTS), K.TILE_OPAQUE_BASE);
  words[K.TILE_DEPTH_BASE] = bits(f32(nearPlane / front));
  words[K.TILE_DEPTH_BASE + 1] = bits(f32(nearPlane / back));
  let offset = K.TILE_STRIDE;
  bins.forEach((list, slice) => {
    words[K.TILE_CLUSTER_BASE + 2 * slice] = offset;
    words[K.TILE_CLUSTER_BASE + 2 * slice + 1] = list.length;
    words.set(list, offset);
    offset += list.length;
  });
  words[K.TILE_CLUSTER_FLAG] = clustered ? 1 : 0;
  return words;
}

/** The record's resolve, run as the shader runs it: `clusterLighting` against `tileLighting`, the
 *  pixel at axis `pixelAxis` in the tile's only tile. */
function sums(words: Uint32Array, lights: Light[], pixelAxis: number) {
  const { clusterLighting, tileLighting } = shaderFunctions<{
    clusterLighting: (...args: unknown[]) => number;
    tileLighting: (...args: unknown[]) => number;
  }>(
    DIRECT_LIGHTING_WGSL.replaceAll('bitcast<f32>(', 'unbits('),
    [
      'clusterLighting',
      'tileLighting',
      'tileSlice',
      'sliceLighting',
      'pixelTile',
      'clusterSliceIndex',
      'clusterDistance',
    ],
    {
      ...K,
      log: Math.log,
      floor: Math.floor,
      unbits,
      depth: {},
      vec2i: (p: { x: number; y: number }) => p,
      vec3f: () => 0,
      textureLoad: () => f32(0.1 / pixelAxis),
      view: { lightParams: { x: lights.length, y: 1, z: 1 }, viewport: { w: 0 } },
      tileLights: words,
      directLights: { count: lights.length, items: lights },
      declaredLight: (light: Light) =>
        Math.abs(pixelAxis - light.axis) <= light.radius ? light.weight : 0,
    },
  );
  const args = [0, 0, 0, 0, 0, 0, 0] as const;
  return {
    cluster: clusterLighting(...args, { x: 8, y: 8 }),
    full: tileLighting(...args, { x: 0, y: 0 }, 1, 0, K.TILE_OPAQUE_BASE),
  };
}

test('a pixel lights exactly develop, for random lamp sets of 1 to 256', () => {
  for (const count of [1, 2, 4, 8, 16, 32, 64, 100, 256]) {
    const r = random(count);
    const [front, back] = [0.5 + r(), 20 + 200 * r()];
    const lights: Light[] = [...Array(count).keys()].map(() => ({
      axis: front * (back / front) ** r(),
      radius: r() * (back / front) ** (r() * 0.4),
      weight: f32(0.5 + r()),
    }));
    // A list past `TILE_LIGHTS` keeps its whole list: the cluster flag is zero, the fallback exact.
    const clustered = count <= K.TILE_LIGHTS;
    const words = record(lights, front, back, 0.1, clustered);
    for (let pixel = 0; pixel < 30; pixel++) {
      const axis = front * (back / front) ** r();
      const { cluster, full } = sums(words, lights, axis);
      assert.equal(
        cluster,
        full,
        `count ${count}, pixel axis ${axis}: cluster ${cluster} vs ${full}`,
      );
    }
  }
});
