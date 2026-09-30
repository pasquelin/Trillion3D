import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeformationFrame } from './frame.ts';
import { deformedOf } from './source.ts';
import { updateWebgpuDeformation } from './webgpuFrame.ts';
import { packClusterSpheres, growClusterBox } from '../webgpu/shadow/bounds.ts';
import { createWebgpuLightState } from '../webgpu/pages/state/lights.ts';
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { PageRec } from '../page/selection/selection.ts';

test('deformation refreshes only its caster rows and grows CPU/GPU light and occlusion bounds', () => {
  const world = new Matrix4(),
    weights = [0];
  const frame = createDeformationFrame([
    deformedOf(
      { morphTargetInfluences: weights },
      { deformation: { joints: [], targets: [100] } },
      world,
    ),
  ]);
  const rec = { min: [-1, -1, -1], max: [1, 1, 1], placementIndex: 0, packedIndex: 0 } as PageRec;
  const root = {
    world,
    pages: [rec],
    reach: 0,
    localBox: new Float64Array([-1, -1, -1, 1, 1, 1]),
    worldBox: new Float64Array([-1, -1, -1, 1, 1, 1]),
  };
  const lights = createWebgpuLightState(2);
  lights.mobility.ensure(1, 2, () => world.elements);
  const dirty: number[] = [],
    changed: number[][] = [];
  lights.plan.worldChanged = (min, max) => {
    changed.push([...Array.from(min), ...Array.from(max)]);
  };
  const rt = {
    // A zero pixel error skips no placement (`screen.ts`).
    vis: {
      deformation: { any: true, frame, base: 0, update: () => frame.update(() => false) },
      concatPos: {},
    },
    gpu: { device: { queue: { writeBuffer() {} } } },
    lights,
    layout: {
      selectionRoots: [root],
      rows: {
        pageTableFloats: new Float32Array(64),
        packedCount: 2,
        rowOfPage: [0],
        packedPageIndex: [0, 1],
        markRowWords: (row: number) => dirty.push(row),
      },
    },
    run: { gate: { pixelError: 0 }, temporalHizState: {} },
    setup: {},
    blendState: { blendGpu: [] },
  } as unknown as WebgpuPagesRuntime;
  const camera = { projection: world.elements } as EngineCamera;
  updateWebgpuDeformation(rt, camera);
  assert.equal(frame.moving[0], 0, 'first upload does not invent TAA velocity');
  assert.equal(changed.length, 1, 'first deformation initializes its shadow region');
  weights[0] = 1;
  updateWebgpuDeformation(rt, camera);
  assert.deepEqual(dirty, [0], 'the unrelated caster is left alone');
  const sphere = packClusterSpheres([rec], [root], new Float32Array(4), 0, 0);
  assert.ok(sphere[3] >= 101, 'the GPU cull and shadow occlusion sphere contains maximum reach');
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  growClusterBox(rec, [root], box);
  assert.ok(box[0] <= -101 && box[3] >= 101, 'CPU light selection contains the same displacement');
  assert.deepEqual(changed.at(-1), [-101, -101, -101, 101, 101, 101]);
  dirty.length = 0;
  updateWebgpuDeformation(rt, camera);
  assert.deepEqual(dirty, [], 'unchanged reach uploads no caster rows');
  weights[0] = 0;
  updateWebgpuDeformation(rt, camera);
  assert.deepEqual(dirty, [0], 'shrinking reach refreshes the sphere too');
  assert.deepEqual(changed.at(-1), [-101, -101, -101, 101, 101, 101], 'old shadows are erased');
});
