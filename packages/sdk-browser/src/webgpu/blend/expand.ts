import {
  BLEND_EXPAND_ENTRIES,
  BLEND_EXPAND_SHADER,
  blendExpandDispatch,
  STORAGE_TYPES,
} from './expandWgsl.ts';
import { shaderFailed } from '../../gpu/core/shaderModule.ts';
import { openValidation, validationError } from '../../gpu/core/errorScope.ts';
import { cleanupFailedHiz } from '../../gpu/hiz/pipelines.ts';
import { blendExpandUniform, EXPAND_PASSES, RUN_WORDS, UNI_WORDS } from './runs.ts';

export type BlendExpand = ReturnType<typeof expandApi>;

/** Each pass has its uniform region, at its own dynamic-binding alignment. */
const UNI_STRIDE = 256;
/**
 * SCENE OBJECT OF THE KERNEL: what it holds per frame, and nothing of the factory that mounted
 * it.
 *
 * Written apart from `createBlendExpand` on purpose: closures returned from the factory would
 * retain its compiled module, layouts and fallback closures, none of which serve after creation.
 */
function expandApi(
  device: GPUDevice,
  tampons: { uniforms: GPUBuffer; plan: GPUBuffer; keep: GPUBuffer; draws: GPUBuffer },
  bindGroup: GPUBindGroup,
  pipelines: GPUComputePipeline[],
  items: number,
  made: GPUBuffer[],
) {
  const { uniforms, plan, keep, draws } = tampons;
  const uni = new Uint32Array(UNI_WORDS);
  // The two arrays encoding rereads in place: one dynamic offset, four dispatches.
  const offsets = [0],
    lancements = [0, 0, 0, 0];
  return {
    /** Static description of each item: paged rank, chunks, table base, vertices. */
    uploadDraws(packed: Uint32Array) {
      device.queue.writeBuffer(
        draws,
        0,
        packed.buffer as ArrayBuffer,
        packed.byteOffset,
        items * 16,
      );
    },
    /** Frustum verdict of the frame: one bit per item, a few hundred bytes. */
    uploadKeep(packed: Uint32Array) {
      device.queue.writeBuffer(keep, 0, packed.buffer as ArrayBuffer, packed.byteOffset);
    },
    /** Paint order and its runs, written only when ranking moved them — and only the runs the
     *  frame carries, a handful, not a few thousand. */
    uploadPlan(
      region: { order: number; runs: number },
      order: Uint32Array,
      runs: Uint32Array,
      runCount: number,
    ) {
      if (!order.length) return;
      const ecris = (at: number, source: Uint32Array, octets: number) =>
        device.queue.writeBuffer(
          plan,
          at * 4,
          source.buffer as ArrayBuffer,
          source.byteOffset,
          octets,
        );
      ecris(region.order, order, order.byteLength);
      ecris(region.runs, runs, Math.max(1, runCount) * RUN_WORDS * 4);
    },
    encode(
      encoder: GPUComputePassEncoder,
      pass: number,
      region: { order: number; runs: number; args: number },
      counts: { entries: number; runs: number; instanceBase: number },
      scene: { maxVertexWords: number; vertexShift: number },
    ) {
      blendExpandUniform(uni, counts, region, scene);
      device.queue.writeBuffer(uniforms, pass * UNI_STRIDE, uni);
      offsets[0] = pass * UNI_STRIDE;
      encoder.setBindGroup(0, bindGroup, offsets);
      blendExpandDispatch(lancements, counts.entries, counts.runs);
      for (let step = 0; step < pipelines.length; step++) {
        encoder.setPipeline(pipelines[step]);
        encoder.dispatchWorkgroups(lancements[step]);
      }
    },
    dispose() {
      for (const buffer of made) buffer.destroy();
    },
  };
}

/**
 * Kernel that expands the sorted plan, and the scene buffers it reads.
 *
 * Nothing is allocated per frame. What the frame gives fits in three writes: the frustum verdict
 * (one bit per item), the paint order when it has moved, and the twelve uniform words of each
 * pass. What the frame gets is the instance list the blend shader reads and one indirect
 * argument per run — never per item.
 */
export async function createBlendExpand(
  device: GPUDevice,
  sizes: { items: number; planWords: number; scratchWords: number },
  shared: { counts: GPUBuffer | undefined; clusters: GPUBuffer | undefined },
  outputs: { expanded: GPUBuffer; args: GPUBuffer },
) {
  if (typeof device.createComputePipeline !== 'function' || sizes.items < 1) return undefined;
  const made: GPUBuffer[] = [];
  const make = (label: string, size: number, usage: number) => {
    const buffer = device.createBuffer({ label, size: Math.max(16, size), usage });
    made.push(buffer);
    return buffer;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const bail = () => {
    for (const buffer of made) buffer.destroy();
    return undefined;
  };
  try {
    const uniforms = make(
      'WG blend expand uniforms',
      UNI_STRIDE * EXPAND_PASSES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const plan = make('WG blend sorted plan', sizes.planWords * 4, storage);
    const keep = make('WG blend frustum verdicts', ((sizes.items + 31) >> 5) * 4, storage);
    const draws = make('WG blend draw descriptions', sizes.items * 16, storage);
    const scratch = make('WG blend expand scratch', sizes.scratchWords * 4, GPUBufferUsage.STORAGE);
    openValidation(device);
    const module = device.createShaderModule({ code: BLEND_EXPAND_SHADER });
    if (await shaderFailed(device, module)) return bail();
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNI_WORDS * 4 },
        },
        ...STORAGE_TYPES.map((type, index) => ({
          binding: index + 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type },
        })),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipelines = BLEND_EXPAND_ENTRIES.map((entryPoint) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } }),
    );
    // Without a paged primitive there is neither a count nor a cluster list to read: the kernel
    // never touches those two bindings, and `draws` fills them — the same group cannot stay empty.
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms, size: UNI_WORDS * 4 } },
        ...[
          plan,
          keep,
          draws,
          shared.counts ?? draws,
          shared.clusters ?? draws,
          scratch,
          outputs.expanded,
          outputs.args,
        ].map((buffer, index) => ({ binding: index + 1, resource: { buffer } })),
      ],
    });
    if (await validationError(device)) return bail();
    return expandApi(
      device,
      { uniforms, plan, keep, draws },
      bindGroup,
      pipelines,
      sizes.items,
      made,
    );
  } catch {
    await cleanupFailedHiz(device, made);
    return undefined;
  }
}
