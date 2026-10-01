import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts';
import { bounceProbeBytes } from '../bounce/limits.ts';

/**
 * The shadows' two shares of the memory budget, as the WebGPU renderer declares them (#1353). The
 * renderer owns its shadow memory: its family sizes the pool, its grant and the batches by its own
 * formulas (`shadowBudgetBytes.ts`, at the pool of 3840 × 2160 under one sun), and only a page that
 * draws with it downloads them. The core splits the budget from the world's creation, before any
 * renderer has arrived, so it holds their two totals, declared: a test proves each the very bytes
 * those formulas give (`shadowShares.test.ts`), and a change of the formulas changes them with it.
 */
/** The shadows' GPU share: the grant at that pool, and the most batches a frame draws. */
export const SHADOW_GPU_SHARE = 944_835_216;
/** The shadows' host share: the page table's mirror, the pool's records, the frame's list and the
 *  batches' flag pages and CPU cut faces, at that pool. */
export const SHADOW_HOST_SHARE = 27_370_080;

/**
 * GPU bytes of the bounce probe cascades at their largest — every level of `cascadeSize³` probes,
 * the nine RGB coefficients, visibility and state of each, in both copies the pass binds (the
 * probes and the snapshot frozen before each update). Fixed whatever the scene.
 */
export const BOUNCE_PROBE_BYTES =
  2 * bounceProbeBytes(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3);
