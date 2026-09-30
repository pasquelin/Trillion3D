import { DEFORMATION_COMPUTE_WGSL, deformationBindings } from './computeWgsl.ts';
import { dispatchGrid } from '../gpu/dag/shader/gridWgsl.ts';
import { DEFORMATION_PASS } from './pass.ts';

/** Builds once; binding identities follow cache relocation and table growth, never a steady frame. */
export async function createDeformationCompute(device: GPUDevice) {
  const layout = device.createBindGroupLayout({ entries: deformationBindings() });
  const pipeline = await device.createComputePipelineAsync({
    label: DEFORMATION_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: {
      module: device.createShaderModule({ code: DEFORMATION_COMPUTE_WGSL }),
      entryPoint: 'deform',
    },
  });
  const image = device.createBuffer({
    label: 'Trillion3D deformation image',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const imageWords = new Uint32Array(4);
  const wholeBuffers: GPUBuffer[] = [];
  const held: { buffers: readonly GPUBuffer[]; group: GPUBindGroup }[] = [];
  const moved = (buffers: readonly GPUBuffer[], slot: number) => {
    if (!held[slot]) return true;
    for (let i = 0; i < buffers.length; i++) if (buffers[i] !== held[slot].buffers[i]) return true;
    return false;
  };
  const bind = (buffers: readonly GPUBuffer[], slot: number) => {
    if (moved(buffers, slot))
      held[slot] = {
        buffers: [...buffers],
        group: device.createBindGroup({
          layout,
          entries: [...buffers, image].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
        }),
      };
    return held[slot].group;
  };
  const encode = (
    encoder: GPUCommandEncoder,
    buffers: readonly GPUBuffer[],
    rows: number,
    frame: number,
    whole?: { table: GPUBuffer; count: number },
  ) => {
    if (!rows && !whole?.count) return;
    imageWords[0] = frame;
    device.queue.writeBuffer(image, 0, imageWords);
    const pass = encoder.beginComputePass({ label: DEFORMATION_PASS });
    pass.setPipeline(pipeline);
    if (rows) {
      pass.setBindGroup(0, bind(buffers, 0));
      pass.dispatchWorkgroups(...dispatchGrid(rows));
    }
    if (whole?.count) {
      for (let i = 0; i < 5; i++) wholeBuffers[i] = i === 3 ? whole.table : buffers[i];
      pass.setBindGroup(0, bind(wholeBuffers, 1));
      pass.dispatchWorkgroups(...dispatchGrid(whole.count));
    }
    pass.end();
  };
  return { encode, dispose: () => image.destroy() };
}

export type DeformationCompute = Awaited<ReturnType<typeof createDeformationCompute>>;
