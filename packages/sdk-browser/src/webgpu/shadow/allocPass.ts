import { computePass } from './computePass.ts';
import { allocationWgsl } from './allocWgsl.ts';
import { WORDS_GROUP, shadowWordsWgsl } from './wordsWgsl.ts';
import { shadowFreshWgsl } from './freshWgsl.ts';
import { SHADOW_FRESH_CULL_WGSL } from './freshCullWgsl.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { SHADOW_DEMAND_PASS, encodeShadowDemand } from './demandPass.ts';
import { shadowKeptFrom } from './poolResize.ts';

/** Labels of the allocation and of the host's table words, as a frame's passes are timed. */
const SHADOW_ALLOC_PASS = 'Trillion3D shadow allocation v1';
const SHADOW_FLOORS_PASS = 'Trillion3D shadow floors v1';
const SHADOW_WORDS_PASS = 'Trillion3D shadow table words v1';
const SHADOW_FRESH_PASS = 'Trillion3D shadow GPU pages v1';
const SHADOW_FRESH_COUNT_PASS = 'Trillion3D shadow GPU page count v1';
const SHADOW_FRESH_ADMIT_PASS = 'Trillion3D shadow GPU page admission v1';
const SHADOW_FRESH_CULL_PASS = 'Trillion3D shadow GPU page cull v1';
const SHADOW_FRESH_SEAL_PASS = 'Trillion3D shadow GPU page seal v1';
/** The GPU's page passes, the floors first: timed under the Shadows stage (`stage/mapping.ts`). */
export const SHADOW_PAGE_PASSES = [
  SHADOW_FLOORS_PASS,
  SHADOW_DEMAND_PASS,
  SHADOW_ALLOC_PASS,
  SHADOW_WORDS_PASS,
  SHADOW_FRESH_PASS,
  SHADOW_FRESH_COUNT_PASS,
  SHADOW_FRESH_ADMIT_PASS,
  SHADOW_FRESH_CULL_PASS,
  SHADOW_FRESH_SEAL_PASS,
] as const;

const READ: GPUBufferBindingType = 'read-only-storage';

/**
 * The GPU allocation of shadow pages (`allocWgsl.ts`), the pass that writes the host's table words
 * under it (`wordsWgsl.ts`) and those of the pages the GPU draws itself — composed and sealed
 * (`freshWgsl.ts`), their casters counted, admitted and culled (`freshCullWgsl.ts`): their
 * pipelines, compiled at
 * prepare for the session's window. They own no buffer: the pool's are made with its request
 * buffer (`allocBuffers.ts`).
 */
export async function createShadowAllocation(device: GPUDevice, pages = SUN_WINDOW) {
  const allocation = allocationWgsl(pages),
    wordsWgsl = shadowWordsWgsl(pages),
    freshWgsl = shadowFreshWgsl(pages);
  const fresh: GPUBufferBindingType[] = ['storage', 'storage', 'storage', 'storage', 'storage'];
  fresh.push('storage', READ, 'storage');
  const allocated: GPUBufferBindingType[] = ['storage', 'storage', 'storage', 'storage', READ];
  allocated.push('storage');
  const culled: GPUBufferBindingType[] = [READ, READ, READ, 'storage', 'storage', READ];
  const pairs = (label: string, entry: string) =>
    computePass(device, SHADOW_FRESH_CULL_WGSL, label, entry, culled);
  const [floors, allocate, words, compose, seal, count, admit, cull] = await Promise.all([
    computePass(device, allocation, SHADOW_FLOORS_PASS, 'claimShadowFloors', allocated),
    computePass(device, allocation, SHADOW_ALLOC_PASS, 'allocateShadowPages', allocated),
    computePass(device, wordsWgsl, SHADOW_WORDS_PASS, 'applyShadowWords', [
      'storage',
      'storage',
      READ,
      'storage',
    ]),
    computePass(device, freshWgsl, SHADOW_FRESH_PASS, 'composeShadowPages', fresh),
    computePass(device, freshWgsl, SHADOW_FRESH_SEAL_PASS, 'sealShadowPages', fresh),
    pairs(SHADOW_FRESH_COUNT_PASS, 'shadowCountPairs'),
    pairs(SHADOW_FRESH_ADMIT_PASS, 'admitShadowPairs'),
    pairs(SHADOW_FRESH_CULL_PASS, 'shadowCullPairs'),
  ]);
  return { floors, allocate, words, compose, count, admit, cull, seal };
}

export type ShadowAllocation = Awaited<ReturnType<typeof createShadowAllocation>>;

/** The allocation's bindings, in order, once the GPU pool holds the host's: none without the
 *  pipelines, the pool or its buffers — the reports then allocate on the host. */
function allocationBound(rt: WebgpuPagesRuntime) {
  const { allocation, pageRequests, shadows } = rt.lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers?.seeded || !pageRequests || !shadows?.texture) return undefined;
  return [
    shadows.dataBuffer,
    pageRequests.buffer,
    buffers.state,
    buffers.keys,
    buffers.params,
    buffers.drawList,
  ];
}

/**
 * The plan's floors (`requests.floors`), claimed at the head of the request buffer just zeroed,
 * before the per-pixel demand marks it: pixels that fill the list never push a floor out of it
 * (`claimShadowFloors`). The first time, the GPU pool is written from the host's, and the plan
 * follows the GPU from then on (`mirror.ts`).
 */
function encodeShadowFloors(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights, run } = rt,
    { allocation, pageRequests, shadows, plan } = lights,
    buffers = pageRequests?.allocation;
  if (!allocation || !buffers || !shadows?.texture) return undefined;
  if (!buffers.seeded) {
    buffers.seed(plan, shadows.dataBuffer);
    plan.gpu.set(true, run.frame);
  }
  // The records it decodes entries with are this frame's, as every write lands before the pass.
  shadows.flushRecords();
  buffers.writeParams(
    run.frame,
    plan.records.generation,
    plan.gpu.asks,
    shadowKeptFrom(lights, run.frame),
  );
  const bound = allocationBound(rt);
  if (bound) allocation.floors(encoder, bound, 1);
  return bound;
}

/**
 * Maps, on the GPU, every page this image asks for: the plan's floors (`encodeShadowFloors`), then
 * its pixels' demand when its light lists were encoded (`demandPass.ts`), right before any page is
 * drawn. The pages it maps, and those it mapped before and saw no draw of since, it lists: the GPU
 * draws them in this frame once the host's pages and words are in (`freshPass.ts`).
 */
export function encodeShadowAsks(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  listed: boolean,
) {
  const bound = encodeShadowFloors(rt, encoder);
  if (listed) encodeShadowDemand(rt, encoder);
  if (bound) rt.lights.allocation!.allocate(encoder, bound, 1);
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
