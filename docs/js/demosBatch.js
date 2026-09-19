/** Batch demos: n elements in one call, checked against the unit function they repeat. */
import {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  hierarchyUpdateBatch,
  multiplyMatrix4,
  multiplyMatrix4Batch,
} from './engine.js';
import { formatNumber, slider, valueView } from './demoKit.js';

export const BATCH_DEMOS = {
  hierarchyUpdateBatch: {
    controls: [slider('count', 'nodes in the batch', 100, 20000, 5000, 100)],
    run(state) {
      const count = Math.round(state.count);
      const views = (buffer, stride) =>
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
