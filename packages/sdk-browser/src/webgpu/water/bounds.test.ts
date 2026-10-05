import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { collectClusterPages } from '../../page/selection/collect.ts';
import { FLAG_CLUSTER_PAGE, FLAG_PAGED } from '../../visibility/types.ts';
import { prepareWebgpuBlend } from '../blend/prepare.ts';
import { createWebgpuBlendState } from '../blend/state.ts';
import { buildBlendStatics, refreshBlendPlan } from '../blend/plan.ts';
import { orderBlendPasses } from '../blend/order.ts';
import { beginWaterBounds, includeWaterItem } from './bounds.ts';
import { device, prepared } from './pass.fixture.ts';
import {
  waterCostScene,
  waterCostCamera,
  poseWaterCost,
  SIZE,
} from '../../../../../tests/gpu/water/waterCostScene.ts';

function scene(enabled = true) {
  const source = waterCostScene(1 / 16, enabled);
  // A compiled geometry-page declaration still takes the source path for transmission.
  for (const page of source.metadata.primitives.at(-1)!.pages)
    page.geometry = { url: 'quantized-water', maxPositionError: 0.01 } as never;
  const collected = collectClusterPages(
    source.source,
    source.metadata,
    source.indices,
    source.associations,
  );
  const state = createWebgpuBlendState(),
    { gpu } = prepared();
  state.transmissive = prepareWebgpuBlend(
    device,
    collected.blendCopies,
    gpu,
    state,
    source.source as never,
  );
  buildBlendStatics(state);
  refreshBlendPlan(state);
  state.volumePacked = new Float32Array(8);
  const host = waterCostCamera();
  poseWaterCost(host, 0, false);
  const camera = readCameraWorld(createEngineCamera(), host);
  state.blendPlanes.set(camera.planes);
  const bounds = state.waterBounds,
    item = state.blendGpu[0];
  const frame = (projection: ArrayLike<number> = camera.viewProjection) => {
    beginWaterBounds(bounds, camera, projection, SIZE);
    return orderBlendPasses(state, camera.eye);
  };
  return { state, bounds, item, camera, frame };
}
const full = [0, 0, ...SIZE];

test('real collect and prepare retain source water and crop only the kept surface', () => {
  const { state, bounds, item, frame } = scene();
  assert.equal(item.flags & (FLAG_PAGED | FLAG_CLUSTER_PAGE), 0);
  frame();
  assert.equal(state.transmissiveInView, 1);
  assert.ok(bounds.surface[0] > 450 && bounds.surface[2] < 830);
  assert.ok(bounds.surface[1] > 250 && bounds.surface[3] < 470);
  // The initial zero-thickness backdrop is tight; declared reach must include displaced patches.
  const initial = Array.from(bounds.backdrop);
  state.volumePacked[2] = 0.5;
  frame();
  assert.ok(bounds.backdrop[0] < initial[0] && bounds.backdrop[2] > initial[2]);
  assert.ok(bounds.backdrop[1] < initial[1] && bounds.backdrop[3] > initial[3]);
  item.bounds = new Float64Array([100, 0, 0, 101, 1, 0]);
  frame();
  assert.equal(state.transmissiveInView, 0);
  assert.deepEqual(Array.from(bounds.surface), [1280, 720, 0, 0], 'no stale previous rect');
  assert.equal(scene(false).frame(), 1, 'parked measurement tile is rejected');
});

test('unknown, nonfinite, near-plane and unsupported geometry conservatively keep full coverage', () => {
  for (const kind of ['unknown', 'nonfinite', 'near', 'quantized', 'distant']) {
    const { bounds, item, state, camera } = scene();
    const elements = item.matrix.elements as number[];
    if (kind === 'unknown') item.bounds = undefined;
    if (kind === 'nonfinite') item.bounds![0] = NaN;
    if (kind === 'near') elements[14] = 2.95;
    if (kind === 'quantized') item.flags |= FLAG_CLUSTER_PAGE;
    if (kind === 'distant') {
      elements[12] = elements[13] = 1e15;
      camera.viewProjection[12] -= camera.viewProjection[0] * 1e15;
      camera.viewProjection[13] -= camera.viewProjection[5] * 1e15;
    }
    beginWaterBounds(bounds, camera, camera.viewProjection, SIZE);
    includeWaterItem(bounds, item, state.volumePacked);
    assert.deepEqual(Array.from(bounds.surface), full, kind);
    assert.deepEqual(Array.from(bounds.backdrop), full, kind);
  }
});

test('jittered GPU matrix is used; singular and nonfinite projections cannot retain old copies', () => {
  const { frame, bounds, camera } = scene();
  frame();
  const left = bounds.surface[0];
  const jitter = camera.viewProjection.slice();
  jitter[12] += 0.1;
  frame(jitter);
  assert.ok(bounds.surface[0] > left);
  frame(new Float64Array(16));
  assert.deepEqual(Array.from(bounds.surface), full);
  assert.deepEqual(Array.from(bounds.backdrop), full);
  jitter[0] = NaN;
  frame(jitter);
  assert.deepEqual(Array.from(bounds.surface), full);
});

test('unavailable water does no bounds work and empty clipped boxes keep legal edge texels', () => {
  const { frame, bounds, camera, item, state } = scene();
  frame();
  const saved = Array.from(bounds.inverse);
  beginWaterBounds(bounds, undefined, new Float64Array(16), SIZE);
  includeWaterItem(bounds, item, state.volumePacked);
  assert.equal(bounds.active, false);
  assert.deepEqual(Array.from(bounds.inverse), saved);
  (item.matrix.elements as number[])[12] = -100;
  beginWaterBounds(bounds, camera, camera.viewProjection, SIZE);
  includeWaterItem(bounds, item, state.volumePacked);
  assert.equal(bounds.surface[0], 0);
  assert.ok(bounds.surface[2] >= 1);
  assert.ok(bounds.backdrop[2] > bounds.backdrop[0]);
});

test('the rectangle covers every kept water item and none of the rejected ones', () => {
  const { state, bounds, item, frame } = scene();
  const moved = (dx: number) => {
    const box = item.bounds!.slice();
    box[0] += dx;
    box[3] += dx;
    const elements = Array.from(item.matrix.elements);
    elements[12] += dx;
    return { ...item, bounds: box, matrix: { ...item.matrix, elements } } as typeof item;
  };
  const alone = (other: typeof item) => {
    state.blendGpu.length = 1;
    state.blendGpu[0] = other;
    frame();
    return Array.from(bounds.surface);
  };
  const width = item.bounds![3] - item.bounds![0];
  const kept = moved(-1.2 * width),
    rejected = moved(100 * width);
  const own = alone(item),
    beside = alone(kept);
  assert.ok(beside[2] < own[2], 'the second kept item lies elsewhere on screen');
  state.blendGpu.splice(0, 1, item, kept, rejected);
  frame();
  assert.equal(state.transmissiveInView, 2, 'the far copy is rejected by the frustum');
  const rect = Array.from(bounds.surface);
  for (const r of [own, beside]) {
    assert.ok(rect[0] <= r[0] && rect[1] <= r[1], 'covers each kept item');
    assert.ok(rect[2] >= r[2] && rect[3] >= r[3], 'covers each kept item');
  }
  // Exactly the kept union: the rejected copy adds nothing, even far off screen.
  assert.deepEqual(rect, [
    Math.min(own[0], beside[0]),
    Math.min(own[1], beside[1]),
    Math.max(own[2], beside[2]),
    Math.max(own[3], beside[3]),
  ]);
});
