// Page of the deformation-kernel proof: the engine's deformation stage (`DEFORMATION_COMPUTE_WGSL`,
// `deformationBindings`) on a real device, over the buffers the proof lays out. Frame after frame
// it applies the proof's writes, stamps the image number, dispatches one group and reads back the
// three vertex records the frame names. Each buffer lands at the binding its shader name has in
// the stage's own text.
import {
  DEFORMATION_COMPUTE_WGSL,
  deformationBindings,
} from '../../../packages/sdk-browser/src/deformation/computeWgsl.ts';
import { DEFORM_VERTEX_WORDS } from '../../../packages/sdk-browser/src/deformation/slotLayout.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import type { BufferName, Frame } from './deformationKernelCases.ts';

/** Each binding of the stage by its shader name, read from the stage's WGSL. */
const BINDING = Object.fromEntries(
  Array.from(
    DEFORMATION_COMPUTE_WGSL.matchAll(/@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g),
    ([, binding, name]) => [name, Number(binding)],
  ),
) as Record<BufferName | 'normals' | 'uvs' | 'image', number>;

/** Vertices the proof's page holds, and the bytes their records span. */
const READ_BYTES = 3 * DEFORM_VERTEX_WORDS * 4;

/** Runs the stage over `frames` from the initial `buffers` (words; the normals as floats);
 *  returns each frame's records as floats, and the errors the device raised. */
export async function run({
  buffers,
  frames,
}: {
  buffers: Record<BufferName | 'normals', number[]>;
  frames: Frame[];
}) {
  const gpu = await openGpuDevice();
  if (!gpu) throw new Error('no WebGPU adapter');
  const { module, compilation } = await gpu.compile(DEFORMATION_COMPUTE_WGSL);
  if (compilation.length) throw new Error(compilation.join('\n'));
  const { device } = gpu;
  const layout = device.createBindGroupLayout({ entries: deformationBindings() });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'deform' },
  });
  const { STORAGE, UNIFORM, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage;
  const buffer = (words: number[], usage: number) => {
    const made = device.createBuffer({
      size: words.length * 4,
      usage: usage | COPY_DST | COPY_SRC,
    });
    device.queue.writeBuffer(made, 0, new Uint32Array(words));
    return made;
  };
  const named = {
    indices: buffer(buffers.indices, STORAGE),
    positions: buffer(buffers.positions, STORAGE),
    pages: buffer(buffers.pages, STORAGE),
    uvs: buffer([0], STORAGE),
    image: buffer([0, 0, 0, 0], UNIFORM),
  };
  // The normals ride in the float pool's r32float atlas (`floatAtlas.ts`, #1410): one row.
  const normals = device.createTexture({
    size: [8192, 1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const normalFloats = new Float32Array(buffers.normals);
  device.queue.writeTexture({ texture: normals }, normalFloats, {}, [normalFloats.length]);
  const group = device.createBindGroup({
    layout,
    entries: [
      ...Object.entries(named).map(([name, made]) => ({
        binding: BINDING[name as keyof typeof named],
        resource: { buffer: made },
      })),
      { binding: BINDING.normals, resource: normals.createView({ dimension: '2d-array' }) },
    ],
  });
  const read = device.createBuffer({ size: READ_BYTES, usage: MAP_READ | COPY_DST });
  const records: number[][] = [];
  for (const [index, { writes, read: from }] of frames.entries()) {
    for (const { buffer: name, at, words } of writes)
      device.queue.writeBuffer(named[name], at * 4, new Uint32Array(words));
    device.queue.writeBuffer(named.image, 0, new Uint32Array([index + 1, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(named[from.buffer], from.at * 4, read, 0, READ_BYTES);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    records.push([...new Float32Array(read.getMappedRange())]);
    read.unmap();
  }
  const adapter = (await gpu.fermer()).court;
  return { adapter, records, errors: gpu.errors };
}
