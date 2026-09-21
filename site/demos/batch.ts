/** Batch demos: n elements in one call, checked against the unit function they repeat. */
import {
  BOX_VALUES,
  HIERARCHY_ROOT,
  IDENTITY_MATRIX4,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  SPHERE_VALUES,
  createCameraFrame,
  frustumKeepsBoxBatch,
  hierarchyUpdateBatch,
  multiplyMatrix4,
  multiplyMatrix4Batch,
  perspectiveProjection,
  sphereFromBoundsBatch,
  transformPointsBatch,
  updateCameraFrame,
} from './engine.ts';
import { formatNumber, slider, valueView } from './kit.ts';
import type { DemoDef } from './kit.ts';

/** The example of the SDK guide: a grid of unit boxes, half of it behind the camera. */
function gridBoxes(count: number) {
  const boxes = new Float64Array(count * BOX_VALUES),
    side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const at = i * BOX_VALUES,
      x = (i % side) - side / 2,
      y = Math.floor(i / side) - side / 2,
      z = i % 2 === 0 ? -20 : 20;
    boxes[at] = x;
    boxes[at + 1] = y;
    boxes[at + 2] = z;
    boxes[at + 3] = x + 1;
    boxes[at + 4] = y + 1;
    boxes[at + 5] = z + 1;
  }
  return boxes;
}

export const BATCH_DEMOS: Record<string, DemoDef> = {
  frustumKeepsBoxBatch: {
    controls: [
      slider('count', 'boxes in the batch', 100, 40000, 10000, 100),
      slider('fov', 'field of view (°)', 20, 110, 60, 1),
    ],
    run(state) {
      const count = Math.round(state.count);
      const boxes = gridBoxes(count),
        kept = new Uint8Array(count),
        spheres = new Float64Array(count * SPHERE_VALUES),
        centres = new Float64Array(count * POSITION_VALUES),
        viewCentres = new Float64Array(count * POSITION_VALUES),
        frame = createCameraFrame(),
        projection = new Float64Array(16);
      perspectiveProjection(projection, state.fov, 16 / 9, 0.1, 1);
      updateCameraFrame(frame, projection, IDENTITY_MATRIX4, 100);
      const visible = frustumKeepsBoxBatch(kept, frame.planes, boxes, count);
      sphereFromBoundsBatch(spheres, boxes, count);
      let m = 0;
      for (let i = 0; i < count; i++) {
        if (!kept[i]) continue;
        const at = i * SPHERE_VALUES;
        centres.set(spheres.subarray(at, at + POSITION_VALUES), m++ * POSITION_VALUES);
      }
      transformPointsBatch(viewCentres, frame.view, centres, m);
      return [
        valueView('cull, then transform the survivors: two calls, no allocation between them', [
          ['boxes tested', String(count)],
          ['kept by the frustum', String(visible)],
          ['rejected by the frustum', String(count - visible)],
          ['behind the camera, by construction', String(Math.floor(count / 2))],
          ['first survivor, view-space z', m ? formatNumber(viewCentres[2]) : '—'],
        ]),
      ];
    },
  },
  hierarchyUpdateBatch: {
    controls: [slider('count', 'nodes in the batch', 100, 20000, 5000, 100)],
    run(state) {
      const count = Math.round(state.count);
      const views = (buffer: Float64Array, stride: number) =>
        Array.from({ length: count }, (_, index) =>
          buffer.subarray(index * stride, (index + 1) * stride),
        );
      const world = new Float64Array(count * MATRIX_VALUES);
      const positions = new Float64Array(count * POSITION_VALUES);
      const rotations = new Float64Array(count * QUATERNION_VALUES);
      const scales = new Float64Array(count * POSITION_VALUES).fill(1);
      const parents = new Uint32Array(count).fill(HIERARCHY_ROOT);
      for (let index = 0; index < count; index++) {
        positions[index * POSITION_VALUES] = index;
        rotations[index * QUATERNION_VALUES + 3] = 1;
        if (index > 0) parents[index] = index - 1;
      }
      const local = new Float64Array(MATRIX_VALUES);
      hierarchyUpdateBatch(
        views(world, MATRIX_VALUES),
        views(positions, POSITION_VALUES),
        views(rotations, QUATERNION_VALUES),
        views(scales, POSITION_VALUES),
        parents,
        count,
        local,
      );
      const last = count - 1;
      return [
        valueView('one chain of nodes, parents before children, in one call', [
          ['nodes', String(count)],
          ['x of the last node — the sum 0 + 1 + … + (n − 1)', formatNumber(world[last * 16 + 12])],
          ['expected', formatNumber((last * (last + 1)) / 2)],
          ['allocations during the call', 'none: the buffers are the caller’s'],
        ]),
      ];
    },
  },
  multiplyMatrix4Batch: {
    controls: [slider('count', 'products in the batch', 100, 50000, 10000, 100)],
    run(state) {
      const count = Math.round(state.count);
      const make = () =>
        Array.from({ length: count }, (_, index) => {
          const m = new Float64Array(16);
          m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, index % 7, 0, 0, 1]);
          return m;
        });
      const a = make(),
        b = make();
      const out = Array.from({ length: count }, () => new Float64Array(16));
      multiplyMatrix4Batch(out, a, b, count);
      const single = new Float64Array(16);
      multiplyMatrix4(single, a[count - 1], b[count - 1]);
      let worst = 0;
      for (let index = 0; index < MATRIX_VALUES; index++)
        worst = Math.max(worst, Math.abs(out[count - 1][index] - single[index]));
      return [
        valueView('the batch against the unit function it repeats', [
          ['products', String(count)],
          ['largest difference on the last element', formatNumber(worst)],
          [
            'note',
            'the unit function stays the oracle; the WebAssembly kernel repeats it term by term',
          ],
        ]),
      ];
    },
  },
};
