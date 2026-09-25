import { DEFAULT_GEOMETRY_POOL_BUDGET } from './pools.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../webgpu/residency/memoryBudgets.ts';
import { SHADOW_BUFFER_BYTES, shadowAtlasBytes } from '../gpu/shadow/atlas.ts';
import { shadowTransmittanceBytes } from '../gpu/shadow/transmittance.ts';
import {
  MAX_SHADOW_POOL_SIDE,
  SHADOW_BATCH_GPU_BYTES,
  SHADOW_BATCH_HOST_BYTES,
} from '../gpu/shadow/batchBudget.ts';
import { shadowTableHostBytes } from '../../../sdk-core/src/scene/light-shadow/table.ts';
import { shadowPoolHostBytes } from '../../../sdk-core/src/scene/light-shadow/pool.ts';
import { shadowAdmissionHostBytes } from '../../../sdk-core/src/scene/light-shadow/admit.ts';
import { DEFAULT_CACHED_BYTES } from '../streaming/pageCache.ts';
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts';
import { bounceProbeBytes } from '../bounce/limits.ts';

/** The shadows at their largest — the pool on the largest screen, its static layer, its
 *  transmittance layer, the fixed buffers beside it, the page table first, and what the most
 *  batches a frame draws add (`batchBudget.ts`): they never hold more, whatever the screen. */
export const SHADOW_POOL_BYTES =
  2 * shadowAtlasBytes(MAX_SHADOW_POOL_SIDE) +
  shadowTransmittanceBytes(MAX_SHADOW_POOL_SIDE) +
  SHADOW_BUFFER_BYTES +
  SHADOW_BATCH_GPU_BYTES;
/** The shadows' host memory at its largest, whatever the screen: the table's words and change
 *  flags, the pool's page records and eviction bits, the frame's list, as the three allocate
 *  them, and the batches' flag pages and CPU cut faces. */
export const SHADOW_HOST_BYTES =
  shadowTableHostBytes(MAX_SHADOW_POOL_SIDE ** 2) +
  shadowPoolHostBytes(MAX_SHADOW_POOL_SIDE) +
  shadowAdmissionHostBytes(MAX_SHADOW_POOL_SIDE ** 2) +
  SHADOW_BATCH_HOST_BYTES;
/**
 * GPU bytes of the bounce probe cascades at their largest — every level of `cascadeSize³` probes,
 * the nine RGB coefficients, visibility and state of each, in both copies the pass binds (the
 * probes and the snapshot frozen before each update). Fixed whatever the scene.
 */
export const BOUNCE_PROBE_BYTES =
  2 * bounceProbeBytes(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3);
/** The GPU total by default: the bounce probes, then the three pools at their defaults. */
export const DEFAULT_GPU_BUDGET =
  SHADOW_POOL_BYTES +
  BOUNCE_PROBE_BYTES +
  DEFAULT_GEOMETRY_POOL_BUDGET +
  DEFAULT_TEXTURE_POOL_BUDGET;
/** The CPU total by default: the shadow page table's host mirror, then the decoded-page cache's
 *  default, what a world's cache held before the mirror was counted. */
export const DEFAULT_CPU_BUDGET = SHADOW_HOST_BYTES + DEFAULT_CACHED_BYTES;

const checkTotal = (bytes: number, name: string) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(name);
};

/**
 * One memory budget, split by a fixed rule — never by what the machine says it has:
 * - GPU: the shadow pool first, at its largest (`SHADOW_POOL_BYTES`), what the atlas, its
 *   static layer and its transmittance layer take on the largest screen, with the page table and
 *   the other fixed shadow buffers; then the bounce probe cascades at their largest
 *   (`BOUNCE_PROBE_BYTES`); the rest in two halves, the geometry pool and the texture pool, each
 *   no larger than its ceiling. The shadows and the probes never shrink: a total under the two
 *   is refused by name. A total that leaves the other two less than their floors — the
 *   root cover, one layer per lane — leaves them at those floors, which the pools' own clamps name.
 * - CPU: the shadow page table's host mirror first (`SHADOW_HOST_BYTES`), fixed whatever the
 *   screen; the decoded-page cache takes the rest (`pageCache.ts`), the session's manifest tables
 *   and transfer queue reserved off it. A total under the mirror is refused by name.
 *   The cut's host tables — group closure and the rule's readiness, sized by the placed pages —
 *   are held in the cache's share too: once the engine is prepared, the session reserves their
 *   exact bytes there (`hostTableBytes`, the streamer's `reserve`), and the decoded pages keep the
 *   rest.
 * At the defaults, the split gives each pool its own default.
 */
export function splitMemoryBudget(gpu: number, cpu: number) {
  checkTotal(gpu, 'INVALID_GPU_BUDGET');
  checkTotal(cpu, 'INVALID_CPU_BUDGET');
  if (gpu < SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES) throw new Error('GPU_BUDGET_UNDER_SHADOW_POOL');
  if (cpu <= SHADOW_HOST_BYTES) throw new Error('CPU_BUDGET_UNDER_SHADOW_MIRROR');
  const half = Math.floor((gpu - SHADOW_POOL_BYTES - BOUNCE_PROBE_BYTES) / 2);
  return {
    shadowPool: SHADOW_POOL_BYTES,
    bounceProbes: BOUNCE_PROBE_BYTES,
    geometryPool: Math.max(1, Math.min(DEFAULT_GEOMETRY_POOL_BUDGET, half)),
    texturePool: Math.max(1, Math.min(DEFAULT_TEXTURE_POOL_BUDGET, half)),
    shadowMirror: SHADOW_HOST_BYTES,
    pageCache: cpu - SHADOW_HOST_BYTES,
  };
}
