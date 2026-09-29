// Recette probe: the actual deformation kernel, compressed skin/morph decode and dynamic history.
// node --experimental-strip-types tests/browser/probes/deformation-gpu.ts
import assert from 'node:assert/strict';
import { probe } from './deformation-gpu-run.ts';
import { Waves } from '../../../packages/sdk-core/src/fluids/waves.ts';
import { encodeGeometryPage } from '../../../packages/page-codec/geometryPage.ts';
import {
  DEFORMATION_COMPUTE_WGSL,
  deformationBindings,
} from '../../../packages/sdk-browser/src/deformation/compute.ts';
import {
  recordLayout,
  KIND_MORPH,
  KIND_SKIN,
} from '../../../packages/sdk-browser/src/deformation/layout.ts';
import {
  FLAG_CLUSTER_PAGE,
  FLAG_DYNAMIC,
} from '../../../packages/sdk-browser/src/visibility/types.ts';
import { installGpuGlobals } from '../../kit/gpu/globals.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

if (import.meta.main) {
  installGpuGlobals();
  const rest = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const page = encodeGeometryPage(
    [0, 1, 2],
    {
      POSITION: { array: rest, itemSize: 3 },
      NORMAL: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1], itemSize: 3 },
      JOINTS_0: { array: new Uint32Array(12), itemSize: 4 },
      WEIGHTS_0: { array: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], itemSize: 4 },
    },
    -16,
    -14,
    [{ POSITION: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1], itemSize: 3 } }],
  );
  const slot = 17,
    output = slot + page.data.length / 4 + 2;
  const pool = new Uint32Array(output + 3 * 11);
  pool.set(new Uint32Array(page.data.buffer, page.data.byteOffset, page.data.length / 4), slot);
  const layout = recordLayout({ joints: 1, targets: 1, waves: 0 });
  const positions = new Float32Array(160);
  const words = new Uint32Array(positions.buffer);
  words.set([KIND_MORPH | KIND_SKIN, KIND_MORPH | KIND_SKIN, 1, 1]);
  positions.set([1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0], layout.palette);
  positions.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], layout.palette + 12);
  positions.set([1, 0], layout.weights);
  const row = new Uint32Array(64);
  row[23] = FLAG_CLUSTER_PAGE;
  row[24] = slot;
  row[25] = 3;
  row[38] = 3;
  row[58] = 1;
  row[59] = output + 1;

  const waves = new Waves([{ direction: [1, 0.3], wavelength: 3, amplitude: 0.2, steepness: 0.3 }]);
  waves.setTime(0.5);
  const whole = new Float32Array(160);
  whole.set(rest);
  new Uint32Array(whole.buffer).set(words.subarray(0, layout.floats), 16);
  whole.set([16, 1, 3, 14], 52);
  for (let v = 0; v < 3; v++) whole.set([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], 56 + v * 14);
  const result = await dansPageWebgpu(probe, {
    whole: [...new Uint32Array(whole.buffer)],
    shader: DEFORMATION_COMPUTE_WGSL,
    bindings: deformationBindings(),
    pool: [...pool],
    positions: [...words],
    row: [...row],
    output,
    dynamic: FLAG_DYNAMIC,
    wave: [
      waves.dirX[0],
      waves.dirZ[0],
      waves.k[0],
      waves.amplitude[0],
      waves.lateral[0],
      waves.phase[0],
      waves.phase[0],
      0,
    ],
  });
  assert.equal(result.unavailable, undefined, result.unavailable);
  assert.deepEqual(result.errors, []);
  const images = result.images!;
  for (let v = 0; v < 3; v++) {
    assert.deepEqual(images[6].slice(v * 11, v * 11 + 9), images[0].slice(v * 11, v * 11 + 9));
    assert.deepEqual(images[0].slice(v * 11, v * 11 + 3), [rest[v * 3] + 2, rest[v * 3 + 1], 1]);
    assert.deepEqual(images[0].slice(v * 11 + 3, v * 11 + 6), rest.slice(v * 3, v * 3 + 3));
    assert.deepEqual(images[1].slice(v * 11 + 3, v * 11 + 6), rest.slice(v * 3, v * 3 + 3));
    assert.deepEqual(images[4].slice(v * 11, v * 11 + 3), [rest[v * 3], rest[v * 3 + 1], 3]);
    const offset = waves.offset(rest[v * 3], rest[v * 3 + 2], []);
    for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(images[5][v * 11 + c] - rest[v * 3 + c] - offset[c]) < 0.01);
    assert.deepEqual(images[2].slice(v * 11 + 3, v * 11 + 6), rest.slice(v * 3, v * 3 + 3));
    assert.deepEqual(images[3].slice(v * 11, v * 11 + 3), images[3].slice(v * 11 + 3, v * 11 + 6));
  }
  console.log(
    JSON.stringify({
      adapter: result.adapter,
      result: 'skin, morph, soft source, waves and dynamic history match',
    }),
  );
}
