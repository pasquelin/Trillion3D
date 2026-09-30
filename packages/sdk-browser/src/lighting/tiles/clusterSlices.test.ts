// #1249: clustered 3D light assignment. A pixel pays only for the lights that reach it: a light is
// assigned to every log-Z slice its view-axis span touches, so the cluster list a pixel walks holds
// no light that would contribute exactly zero there (`directIncidence`) and misses none that
// reaches it. The shipped WGSL mapping is run here through `shaderFunctions`, and the binning
// property — every reaching light present, in increasing rank order — is checked on random cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { clusterBinsWgsl, CLUSTER_SLICES } from './clusterWgsl.ts';
import { sliceMap, type SliceMap } from './clusterSlices.fixture.ts';

test('the shipped slice mapping is bounded, monotone and log-spaced on the tile range', () => {
  const { clusterSliceIndex } = sliceMap();
  const [front, back] = [0.5, 500];
  assert.equal(clusterSliceIndex(front, front, back), 0, 'the tile front is the first slice');
  assert.equal(clusterSliceIndex(back, front, back), CLUSTER_SLICES - 1, 'its back the last');
  assert.equal(clusterSliceIndex(front / 2, front, back), 0, 'before the front, the first');
  assert.equal(
    clusterSliceIndex(10 * back, front, back),
    CLUSTER_SLICES - 1,
    'past the back, last',
  );
  assert.equal(clusterSliceIndex(3, front, front), 0, 'a flat tile is one slice');
  let previous = 0;
  for (let i = 0; i <= 400; i++) {
    const slice = clusterSliceIndex(front * (back / front) ** (i / 400), front, back);
    assert.ok(slice >= previous && slice < CLUSTER_SLICES, `monotone, in range: ${slice}`);
    previous = slice;
  }
});

/** The slice of an axis distance, and the span of a sphere on it, as the shader computes them. */
const bin = (
  map: SliceMap,
  lights: { axis: number; radius: number; rank: number }[],
  front: number,
  back: number,
) =>
  lights
    .filter((light) => {
      const span = map.clusterSliceSpan(light.axis, light.radius, front, back);
      return span.x < span.y;
    })
    .map((light) => ({
      ...light,
      span: map.clusterSliceSpan(light.axis, light.radius, front, back),
    }));

test('every light that reaches a pixel is in its cluster, in increasing rank order', () => {
  const map = sliceMap();
  for (let seed = 1; seed <= 300; seed++) {
    const r = random(seed);
    const [front, back] = [0.2 + r() * 2, 20 + r() * 400];
    const lights = [...Array(48).keys()].map((rank) => ({
      rank,
      axis: front * (back / front) ** r(),
      radius: r() * (back / front) ** (r() * 0.5),
    }));
    const binned = bin(map, lights, front, back);
    for (let pixel = 0; pixel < 40; pixel++) {
      const axis = front * (back / front) ** r();
      const slice = map.clusterSliceIndex(axis, front, back);
      const list = binned.filter((light) => slice >= light.span.x && slice < light.span.y);
      const reaches = (light: { axis: number; radius: number }) =>
        Math.abs(axis - light.axis) <= light.radius;
      const ranks = list.map((light) => light.rank);
      assert.deepEqual(
        ranks,
        [...ranks].sort((a, b) => a - b),
        'increasing rank order',
      );
      for (const light of lights)
        if (reaches(light))
          assert.ok(
            ranks.includes(light.rank),
            `slice ${slice} lost light ${light.rank} at axis ${axis}`,
          );
    }
  }
});

test('each tile bins into its own pool room, names a full pool, and reads the list after it lands', () => {
  assert.ok(CLUSTER_SLICES >= 2 && CLUSTER_SLICES <= 64, 'a usable slice count');
  // The descriptors start at the room the tile's atomic add returned, never at the pool's start
  // for every tile, which would write all tiles' bins over one another.
  assert.match(clusterBinsWgsl, /clusterFirst=pool\.start\+at;/);
  assert.match(clusterBinsWgsl, /TILE_CLUSTER_BASE\+2u\*s\]=clusterFirst\+sliceStart\[s\]/);
  // A pool too small for the bins raises the overflow, so the next frame grows it.
  assert.match(clusterBinsWgsl, /else\{atomicStore\(&pool\.overflow,1u\);\}/);
  // The compaction's storage writes are visible before any lane reads the list back.
  assert.match(
    clusterBinsWgsl,
    /workgroupUniformLoad\(&counted\)\.x;\s*(\/\/[^\n]*\n\s*)*storageBarrier\(\);/,
  );
});
