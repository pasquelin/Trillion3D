import { SHADOW_BUFFER_BYTES, shadowAtlasBytes } from '../gpu/shadow/atlas.ts';
import { shadowRequestBytes } from '../webgpu/shadow/pageRequests.ts';
import { shadowTransmittanceBytes } from '../gpu/shadow/transmittance.ts';
import { SHADOW_BATCH_GPU_BYTES, SHADOW_BATCH_HOST_BYTES } from '../gpu/shadow/batchBudget.ts';
import {
  shadowPoolSize,
  shadowPoolShape,
} from '../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowTableHostBytes } from '../../../sdk-core/src/scene/light-shadow/table.ts';
import { shadowPoolHostBytes } from '../../../sdk-core/src/scene/light-shadow/pool.ts';
import { shadowAdmissionHostBytes } from '../../../sdk-core/src/scene/light-shadow/admit.ts';

/** The pool the shadows are counted at, 3840 × 2160 under one sun (`shadowPoolSize`): its atlas
 *  bytes are the most the grant allots a pool (`webgpu/shadow/poolSize.ts`). */
const { side, layers } = shadowPoolShape(shadowPoolSize(3840, 2160));
/** Its pages: the most a pool is granted, whatever its screen or option asks. */
const SHADOW_POOL_PAGES = side * side * layers;

export const SHADOW_ATLAS_BYTES = shadowAtlasBytes(side, layers);

/** The shadows' one memory grant, at that pool — the atlas, its static and transmittance layers,
 *  the buffers beside it, the page table first (`webgpu/shadow/memoryGrant.ts`). */
export const SHADOW_GRANT_BYTES =
  2 * SHADOW_ATLAS_BYTES +
  shadowTransmittanceBytes(side, layers) +
  SHADOW_BUFFER_BYTES +
  shadowRequestBytes(SHADOW_POOL_PAGES);

/** The shadows' GPU share: the grant, and what the most batches a frame draws add
 *  (`batchBudget.ts`). */
export const SHADOW_POOL_BYTES = SHADOW_GRANT_BYTES + SHADOW_BATCH_GPU_BYTES;

/** The shadows' host memory at that pool: the table's words and change flags, the pool's page
 *  records and eviction bits, the frame's list, as the three allocate them, and the batches' flag
 *  pages and CPU cut faces. */
export const SHADOW_HOST_BYTES =
  shadowTableHostBytes(SHADOW_POOL_PAGES) +
  shadowPoolHostBytes(SHADOW_POOL_PAGES) +
  shadowAdmissionHostBytes(SHADOW_POOL_PAGES) +
  SHADOW_BATCH_HOST_BYTES;
