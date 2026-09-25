import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import type { DrawnLog } from '../dag/types.ts';
import { shadowBatchWrites } from './batchWrites.ts';

/** What the light cull reads beside the cut's log: spheres, mobility words, draw records, and the
 *  page → row map with the pass prelude that refreshes it (`../draw/lightRows.ts`). */
export interface ShadowLightSource {
  spheres: GPUBuffer;
  mobility: GPUBuffer;
  items: GPUBuffer;
  rowOf: GPUBuffer;
  log: DrawnLog;
  /** The blended casters' rows, `[blendFirst, blendEnd)`: kept without a draw record. */
  blendFirst: number;
  blendEnd: number;
  /** Encodes, as the pass's first dispatch, whatever the map owes the rows rewritten since. */
  refreshRows(pass: GPUComputePassEncoder): void;
}

/** The cull buffers the light entry writes, shared with the CPU-list entry (`cull.ts`). */
interface CullTargets {
  kept: GPUBuffer;
  indirect: GPUBuffer;
  faces: GPUBuffer;
  capacity: number;
}

const READ: GPUBufferBindingType = 'read-only-storage';
/** Bind order: spheres, log, cut work, kept, kept commands, uniform, volumes, mobility, draw
 *  records, page → row map — `SHADOW_LIGHT_CULL_SHADER`'s bindings. */
const BINDING_TYPES: readonly GPUBufferBindingType[] = [
  READ,
  READ,
  READ,
  'storage',
  'storage',
  'uniform',
  'uniform',
  READ,
  READ,
  READ,
];

/**
 * The shadow cull of a GPU light cut: ONE compute pass for every region of the frame, whatever the
 * views — the row map's refresh, then one dispatch whose `y` is the region and whose `x` covers the
 * widest view's drawn log, read on the card (`DrawnLog.groupsWord`) and copied into the dispatch
 * argument. A region then tests its own view's pages alone (`Face.view`), and a view that drew
 * nothing costs its regions one early exit per group.
 */
export async function createShadowLightCull(device: GPUDevice, targets: CullTargets) {
  const module = await createCheckedShaderModule(
    device,
    SHADOW_LIGHT_CULL_SHADER,
    'SHADOW_LIGHT_CULL',
  );
  const layout = device.createBindGroupLayout({
    entries: BINDING_TYPES.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'shadowCullLight' },
  });
  const uniforms = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const args = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const uniData = new Uint32Array(8),
    argData = new Uint32Array([0, 0, 1]);
  let bound: GPUBuffer[] = [],
    group: GPUBindGroup | undefined;
  return {
    /** Culls regions `[0, regions)` against `from`'s log; `rows` bounds the page table. */
    encode(encoder: GPUCommandEncoder, from: ShadowLightSource, regions: number, rows: number) {
      if (!regions) return;
      const { log } = from;
      const buffers = [from.spheres, log.buffer, log.work, targets.kept, targets.indirect];
      buffers.push(uniforms, targets.faces, from.mobility, from.items, from.rowOf);
      if (!group || buffers.some((buffer, binding) => bound[binding] !== buffer)) {
        bound = buffers;
        group = device.createBindGroup({
          layout,
          entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      }
      uniData[0] = log.offset;
      uniData[1] = log.offsetWord;
      uniData[2] = log.countWord;
      uniData[3] = targets.capacity;
      uniData[4] = rows;
      uniData[5] = from.blendFirst;
      uniData[6] = from.blendEnd;
      shadowBatchWrites(device).write(uniforms, 0, uniData);
      argData[1] = regions;
      shadowBatchWrites(device).write(args, 0, argData);
      encoder.copyBufferToBuffer(log.work, log.groupsWord * 4, args, 0, 4);
      const pass = encoder.beginComputePass({ label: 'Trillion3D shadow cull' });
      from.refreshRows(pass);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroupsIndirect(args, 0);
      pass.end();
    },
    dispose() {
      uniforms.destroy();
      args.destroy();
    },
  };
}
