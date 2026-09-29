// Recette probe: the actual deformation kernel, compressed skin/morph decode and dynamic history.
// node --experimental-strip-types tests/browser/probes/deformation-gpu.ts
import assert from 'node:assert/strict';
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
const positions = new Float32Array(layout.floats);
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

type Args = {
  shader: string;
  bindings: GPUBindGroupLayoutEntry[];
  pool: number[];
  positions: number[];
  row: number[];
  output: number;
  dynamic: number;
};
async function probe(args: Args) {
  const gpu = await globalThis.ouvrirAppareil();
  if (!gpu) return { unavailable: 'WebGPU unavailable' };
  const compiled = await gpu.compile(args.shader);
  if (compiled.compilation.length) return { errors: compiled.compilation };
  const device = gpu.device;
  const bindLayout = device.createBindGroupLayout({ entries: args.bindings });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    compute: { module: compiled.module, entryPoint: 'deform' },
  });
  const data = [args.pool, args.positions, new Array(21).fill(0), args.row, [0], [1, 0, 0, 0]];
  const buffers = data.map((values, binding) => {
    const buffer = device.createBuffer({
      size: values.length * 4,
      usage:
        (binding === 5 ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, new Uint32Array(values));
    return buffer;
  });
  const group = device.createBindGroup({
    layout: bindLayout,
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const read = device.createBuffer({
    size: 3 * 11 * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const images: number[][] = [];
  for (let frame = 1; frame <= 4; frame++) {
    if (frame === 2) {
      const dynamicRow = new Uint32Array(args.row);
      dynamicRow[23] = args.dynamic;
      dynamicRow[58] = 0;
      device.queue.writeBuffer(buffers[3], 0, dynamicRow);
      device.queue.writeBuffer(buffers[1], 0, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    }
    if (frame === 3)
      device.queue.writeBuffer(buffers[1], 0, new Float32Array([0, 0, 2, 1, 0, 2, 0, 1, 2]));
    device.queue.writeBuffer(buffers[5], 0, new Uint32Array([frame, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(buffers[0], args.output * 4, read, 0, 3 * 11 * 4);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    images.push([...new Float32Array(read.getMappedRange())]);
    read.unmap();
  }
  const adapter = await gpu.fermer();
  return { images, errors: gpu.erreurs, adapter: adapter.court };
}
const result = await dansPageWebgpu(probe, {
  shader: DEFORMATION_COMPUTE_WGSL,
  bindings: deformationBindings(),
  pool: [...pool],
  positions: [...words],
  row: [...row],
  output,
  dynamic: FLAG_DYNAMIC,
});
assert.equal(result.unavailable, undefined, result.unavailable);
assert.deepEqual(result.errors, []);
const images = result.images!;
for (let v = 0; v < 3; v++) {
  assert.deepEqual(images[0].slice(v * 11, v * 11 + 3), [rest[v * 3] + 2, rest[v * 3 + 1], 1]);
  assert.deepEqual(images[0].slice(v * 11 + 3, v * 11 + 6), rest.slice(v * 3, v * 3 + 3));
  assert.deepEqual(images[2].slice(v * 11 + 3, v * 11 + 6), rest.slice(v * 3, v * 3 + 3));
  assert.deepEqual(images[3].slice(v * 11, v * 11 + 3), images[3].slice(v * 11 + 3, v * 11 + 6));
}
console.log(
  JSON.stringify({ adapter: result.adapter, result: 'skin, morph and dynamic history match' }),
);
