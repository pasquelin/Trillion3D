import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  SHADOW_RECORD_FLOATS,
} from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PAGE_BIND_ALIGN } from '../draw/contract.ts';
import { VIEW_BLOCK_WORDS } from '../dag/viewLayout.ts';

// The shadow sizes read before any pass is built — the batches' memory (`batchBudget.ts`), the
// pool's grant and the memory budget's shadow shares (`../../residency/shadowBudgetBytes.ts`) —
// kept apart from the shader texts and pipelines, so that the CDN core, which holds the budget,
// holds none of the WebGPU shadow passes (#1353).

/** Pages one GPU batch draws: the size of the per-batch buffers. A frame draws every page it
 *  marks, in as many batches as that takes (`../../webgpu/pages/render/encodeShadowBatches.ts`). */
export const MAX_SHADOW_PAGES: number = LIGHT_SETTINGS.shadowPagesPerBatch;
/** Regions at most in a batch: a page draws its static layer and its moving casters, two at most. */
export const MAX_SHADOW_REGIONS = 2 * MAX_SHADOW_PAGES;
/** Bytes of a drawn face's uniform entry, one per region (`atlas.ts`): a dynamic-offset stride. */
export const SHADOW_FACE_STRIDE = PAGE_BIND_ALIGN;

/** Words of one view's uniform block: the uniform array's stride (`../dag/shader/shader.ts`,
 *  `Uniforms`). It is the field table's own size (`../dag/viewLayout.ts`) — the table that also
 *  generates the struct — so a field added to the block moves every stride and every byte count
 *  here with it, rather than leaving this literal to be one word short of the shader. */
export const DAG_VIEW_WORDS = VIEW_BLOCK_WORDS;
/** Bytes of the uniform array a cut binds: every view's block, whatever the views it runs — one
 *  view per page a batch draws at most (`DAG_MAX_VIEWS`, `../dag/shader/viewsWgsl.ts`). */
export const DAG_UNIFORM_BYTES = MAX_SHADOW_PAGES * DAG_VIEW_WORDS * 4;

/** Bytes of the records, before the page table in the same buffer: where the table starts. */
export const SHADOW_TABLE_OFFSET = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then the page table, one buffer; the table sized to the session's window. */
export const dataBytesOf = (tableEntries: number) => SHADOW_TABLE_OFFSET + tableEntries * 4;
/** Bytes of the buffers beside the pool — faces, records, a table of `tableEntries` (`plan.ts`). */
export const shadowBufferBytes = (tableEntries: number) =>
  MAX_SHADOW_REGIONS * (SHADOW_FACE_STRIDE + 4) + dataBytesOf(tableEntries);
export const SHADOW_BUFFER_BYTES = shadowBufferBytes(SHADOW_TABLE_ENTRIES);
/** Bytes of a pool of `layers` of `poolSide` pages a side: one 32-bit depth texel each. */
export const shadowAtlasBytes = (poolSide: number, layers = 1) =>
  (poolSide * SHADOW_PAGE) ** 2 * 4 * layers;
/** Bytes of the transmittance layer for a pool of `layers` of `poolSide` pages a side
 *  (`transmittance.ts`): a quarter of the pool's texels, 4 bytes of transmittance and 4 of depth
 *  each. */
export const shadowTransmittanceBytes = (poolSide: number, layers = 1) =>
  ((poolSide * SHADOW_PAGE) / 2) ** 2 * 8 * layers;
