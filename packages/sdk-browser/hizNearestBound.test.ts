// REVERSE-Z: a box is hidden only if its nearest bound is SMALLER than the farthest occluder
// of its footprint. A safe bound therefore OVERSTATES what the cluster will write — the exact
// inverse of the sense it had in forward-Z.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_LAYER_BIAS_UNITS } from '../sdk-core/index.ts';
import { hizNearestBound } from './hizNearestBound.ts';
import { hizRejects, type HizBounds, type HizPyramid } from './hiz.ts';

const f32 = new Float32Array(1),
  bits = new Uint32Array(f32.buffer);
const patternOf = (value: number) => {
  f32[0] = value;
  return bits[0];
};

/** Two neighbouring `float32`s, and a double between them whose round-to-nearest **goes down**. */
function voisins() {
  f32[0] = 0.75;
  const low = f32[0];
  bits[0] += 1;
  const high = f32[0];
  return { low, high, between: low + (high - low) * 0.2 };
}

test('the bound sent to the kernel never falls below the depth it overstates', () => {
  const { low, high, between } = voisins();
  assert.ok(Math.fround(between) < between, 'the chosen case must round down');
  assert.equal(Math.fround(between), low);
  assert.ok(hizNearestBound(between, 0) >= between);
  assert.equal(hizNearestBound(between, 0), high);
  // Over a whole range of depths, including already-representable values and values just
  // below a `float32`, the bound stays above its input.
  for (const base of [1e-7, 0.001, 0.5, low, high, 0.9999999, 1]) {
    for (const value of [base, base * (1 + 1e-9), base * (1 - 1e-9)]) {
      const bound = hizNearestBound(value, 0);
      assert.ok(bound >= value, `hizNearestBound(${value})=${bound}`);
      assert.equal(bound, Math.fround(bound), 'the bound is an exact float32');
      assert.ok(bound < value * (1 + 1e-6), 'and it only rises by one ulp');
    }
  }
  // Zero and negative values — which never reject anything — are returned as-is.
  assert.equal(hizNearestBound(0, 3), 0);
  assert.equal(hizNearestBound(-0.25, 3), -0.25);
});

test('a coplanar layer adds to the bound exactly the units by which it advances the cluster', () => {
  const nearest = 0.875;
  assert.equal(hizNearestBound(nearest, 0), Math.fround(nearest * (1 + 2 ** -24)));
  for (const layer of [1, 2, 7, 15]) {
    const bound = hizNearestBound(nearest, layer);
    assert.equal(
      patternOf(bound),
      patternOf(hizNearestBound(nearest, 0)) + layer * DEPTH_LAYER_BIAS_UNITS,
      `layer ${layer}`,
    );
    assert.ok(bound > nearest);
  }
  // A depth flush with the near plane cannot overshoot it.
  assert.ok(hizNearestBound(1, 15) <= 1);
});

/** A one-texel pyramid whose depth is `far`. */
function pyramide(far: number): HizPyramid {
  return {
    data: Float32Array.from([far]),
    offsets: Int32Array.from([0]),
    widths: Int32Array.from([1]),
    heights: Int32Array.from([1]),
    count: 1,
  };
}

const box = (nearestDepth: number): HizBounds => ({
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  nearestDepth,
  clipsNear: false,
});

test('the corrected bound can only make more be drawn, never less', () => {
  const { low, high, between } = voisins();
  // The pyramid sees exactly `high`: the round-to-nearest bound would reject a cluster that
  // still paints its pixel; the corrected bound does not.
  const pyramid = pyramide(high);
  assert.equal(hizRejects(pyramid, box(Math.fround(between))), true);
  assert.equal(hizRejects(pyramid, box(hizNearestBound(between, 0))), false);
  // And on a cluster plainly behind, the reject still holds.
  assert.equal(hizRejects(pyramid, box(hizNearestBound(low - (high - low) * 64, 0))), true);
  // A layer-1 cluster whose corner is behind the occluder by exactly its layer bias will be
  // drawn in front of it: without the correction it would be rejected, with it it is not.
  const derriere = new Float32Array(1);
  derriere[0] = high;
  new Uint32Array(derriere.buffer)[0] -= DEPTH_LAYER_BIAS_UNITS;
  assert.equal(hizRejects(pyramid, box(derriere[0])), true);
  assert.equal(hizRejects(pyramid, box(hizNearestBound(derriere[0], 1))), false);
});
