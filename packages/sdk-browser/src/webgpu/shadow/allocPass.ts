import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts';
import { ALLOCATION_WGSL } from './allocWgsl.ts';
import { SHADOW_WORDS_WGSL, WORDS_GROUP } from './wordsWgsl.ts';
import { SHADOW_FRESH_WGSL } from './freshWgsl.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { SHADOW_DEMAND_PASS } from './demandPass.ts';

/** Labels of the allocation and of the host's table words, as a frame's passes are timed. */
const SHADOW_ALLOC_PASS = 'Trillion3D shadow allocation v1';
const SHADOW_WORDS_PASS = 'Trillion3D shadow table words v1';
const SHADOW_FRESH_PASS = 'Trillion3D shadow GPU pages v1';
/** The GPU's page passes, the demand first: timed under the Shadows stage (`stage/mapping.ts`). */
export const SHADOW_PAGE_PASSES = [
  SHADOW_DEMAND_PASS,
  SHADOW_ALLOC_PASS,
  SHADOW_WORDS_PASS,
  SHADOW_FRESH_PASS,
] as const;

/** A compute pass of storage buffers only, its bind group made again only when they moved. */
async function computePass(
  device: GPUDevice,
  wgsl: string,
  label: string,
  entryPoint: string,
  types: GPUBufferBindingType[],
) {
  const module = await createCheckedShaderModule(device, wgsl, label);
  const layout = device.createBindGroupLayout({
    label,
    entries: types.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pipeline = device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint },
  });
  const bound = createWebgpuBindIdentity();
  let group: GPUBindGroup | undefined;
  return (encoder: GPUCommandEncoder, buffers: readonly GPUBuffer[], groups: number) => {
    bound.next.length = 0;
    bound.next.push(...buffers);
    if (bound.moved() || !group)
      group = device.createBindGroup({
        label,
        layout,
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(groups);
    pass.end();
  };
}

const READ: GPUBufferBindingType = 'read-only-storage';

/**
 * The GPU allocation of shadow pages (`allocWgsl.ts`), the pass that writes the host's table words
 * under it (`wordsWgsl.ts`) and the one that composes the pages the GPU draws itself
 * (`freshWgsl.ts`): their pipelines, compiled at prepare. They own no buffer: the pool's are made
 * with its request buffer (`allocBuffers.ts`).
 */
export async function createShadowAllocation(device: GPUDevice) {
  const [allocate, words, fresh] = await Promise.all([
    computePass(device, ALLOCATION_WGSL, SHADOW_ALLOC_PASS, 'allocateShadowPages', [
      'storage',
      'storage',
      'storage',
      'storage',
      READ,
      'storage',
    ]),
    computePass(device, SHADOW_WORDS_WGSL, SHADOW_WORDS_PASS, 'applyShadowWords', [
      'storage',
      'storage',
      READ,
      'storage',
    ]),
    computePass(device, SHADOW_FRESH_WGSL, SHADOW_FRESH_PASS, 'composeShadowPages', [
      'storage',
      'storage',
      READ,
      'storage',
      'storage',
      'storage',
      READ,
      'storage',
    ]),
  ]);
  return { allocate, words, fresh };
}

export type ShadowAllocation = Awaited<ReturnType<typeof createShadowAllocation>>;

/**
 * Maps, on the GPU, every page this image asks for — its pixels' demand (`demandPass.ts`) and the
 * plan's floors —, right after the demand and before any page is drawn. The first time, the GPU
 * pool is written from the host's, and the plan follows the GPU from then on (`mirror.ts`).
 * Nothing without the pipelines, the pool or its buffers: the reports then allocate on the host.
 *
 * The pages it maps, and those it mapped before and saw no draw of since, it lists: the GPU draws
 * them in this frame once the host's pages and words are in (`freshPass.ts`).
 */
export function encodeShadowAllocation(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights, run } = rt,
    { allocation, pageRequests, shadows, plan } = lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers || !pageRequests || !shadows?.texture) return;
  if (!buffers.seeded) {
    buffers.seed(plan, shadows.dataBuffer, SHADOW_TABLE_OFFSET);
    plan.gpu.set(true, run.frame);
  }
  // The records it decodes entries with are this frame's, as every write lands before the pass.
  shadows.flushRecords();
  buffers.writeParams(run.frame, plan.records.generation, plan.gpu.asks);
  const bound = [
    shadows.dataBuffer,
    pageRequests.buffer,
    buffers.state,
    buffers.keys,
    buffers.params,
    buffers.drawList,
  ];
  allocation.allocate(encoder, bound, 1);
}

/**
 * The page-table words the frame's plan changed, after its pages are drawn and before any is
 * read: written as they are while the host allocates, sent to the GPU, which keeps a word only for
 * the page it says the entry owns, while it does (`wordsWgsl.ts`). The records go out with them.
 */
export function flushShadowTable(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { allocation, pageRequests, shadows, plan } = rt.lights,
    buffers = pageRequests?.allocation;
  if (!shadows?.texture) return;
  if (!allocation || !buffers?.seeded || !plan.gpu.on) return shadows.flushData(plan.table);
  const count = buffers.writeWords(plan, rt.run.frame, (sink) =>
    shadows.flushData(plan.table, sink),
  );
  if (count)
    allocation.words(
      encoder,
      [shadows.dataBuffer, buffers.state, buffers.words, buffers.drawList],
      Math.ceil(count / WORDS_GROUP),
    );
}
