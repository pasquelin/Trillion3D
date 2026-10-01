import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { LAYER_PAGES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { DRAW_INDIRECT_STRIDE, DRAW_INDIRECT_WORDS, PAGE_BIND_ALIGN } from '../draw/contract.ts';
import { DAG_UNIFORM_BYTES } from '../dag/shader/viewsWgsl.ts';
import { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS } from './recordPack.ts';

/**
 * THE MEMORY OF A FRAME'S SHADOW BATCHES. A frame draws every page it marks, in as many batches as
 * that takes (`../../webgpu/pages/render/encodeShadowBatches.ts`); what each batch adds — its
 * staged writes, its flag word, its CPU cut's faces, its sampled counts — is sized here from one
 * rule and counted in the memory budget (`residency/memoryBudget.ts`).
 *
 * The grant: a batch holds `MAX_SHADOW_PAGES` pages — the shaders' arrays —, in at most one light
 * view per page, and the memory budget holds `MAX_SHADOW_BATCHES` batches, one pool layer
 * (`LAYER_PAGES`) in full batches. What a frame may draw is the current pool's, within that grant
 * (`shadowBatchCapacity`); a frame that lists more — a view limit a light cut bisected after
 * dropping work (`../dag/lightCutRedraws.ts`) — draws its capacity and leaves the rest pending,
 * drawn the next frame.
 */

/**
 * THE PAGES ONE FRAME DRAWS AT MOST: eight full batches. A frame that marks more — a scene's first
 * frames, a camera cut, a sun moved — draws this many, the coarsest and the oldest first
 * (`admit.ts`), and the rest the next frames; meanwhile a page not drawn reads the coarser level
 * under it, as the reference engine's virtual shadow maps read a page their frame did not render. Without it,
 * a burst of 2 423 pages in one frame took 286 ms of GPU on a-field-of-pebbles, and 563 pages
 * 66 ms on drive-a-car (#831). The GPU's own mapping holds to a smaller one, below. It is
 * above what a moving body re-renders a frame — 80 to 140 pages for the car —, so a body's
 * pages are never left a frame behind it.
 */
export const SHADOW_PAGES_PER_FRAME = 8 * MAX_SHADOW_PAGES;
/**
 * The pages the GPU maps and draws itself at most a frame (`allocWgsl.ts`, `freshPass.ts`): four
 * batches. Its draw keeps every resident caster row a page's volume touches, at the finest form
 * the residency holds, with no light cut choosing a coarser one for a coarse page: a sun page of a
 * far level then draws the whole field. 192 such pages took 150 to 180 ms on a-field-of-pebbles
 * (#831); half as many halve it, and the pages past them are mapped the next frames.
 */
export const SHADOW_GPU_PAGES_PER_FRAME = 4 * MAX_SHADOW_PAGES;

/** Batches the memory grant holds: one pool layer, `LAYER_PAGES` pages, in full batches. */
export const MAX_SHADOW_BATCHES = Math.ceil(LAYER_PAGES / MAX_SHADOW_PAGES);
/** Light views, one per face a batch draws, of the granted batches together: a batch draws at
 *  most one view per page, whichever cut selects its casters. */
export const MAX_SHADOW_RUNS = MAX_SHADOW_BATCHES * MAX_SHADOW_PAGES;
/** Frames whose light-cut flag words may be in flight at once (`../dag/lightCutRedraws.ts`): at
 *  120 frames a second, a readback's round trip — the GPU's queue, then the map — can span more
 *  than four, and a frame that finds none free draws its light-cut pages a frame later (#1142). */
export const SHADOW_FLAG_FRAMES = 8;

/** Bytes of a drawn face's uniform entry, one per region (`atlas.ts`): a dynamic-offset stride. */
export const SHADOW_FACE_STRIDE = PAGE_BIND_ALIGN;
/** Words of one face's cull uniform (`cull.ts`), of the light cut's cull uniform and its
 *  dispatch argument (`lightCull.ts`), of a region's occlusion slot and the occlusion uniform
 *  (`occlusion.ts`), of one page's bounds in the page pyramids (`pageHiz.ts`), and of a raster bin
 *  run's uniform, two runs a batch (`bins.ts`). */
export const CULL_UNIFORM_WORDS = 8,
  BIN_UNIFORM_WORDS = 4,
  BIN_RUNS = 2,
  LIGHT_CULL_UNIFORM_WORDS = 8,
  LIGHT_CULL_ARG_WORDS = 3,
  OCCLUSION_SLOT_WORDS = 4,
  OCCLUSION_UNIFORM_WORDS = 4,
  PAGE_BOUNDS_WORDS = 12;
/** Indirect commands of a region, and their bytes: its casters no fragment cuts, drawn with no
 *  fragment stage, then its cutout casters, drawn with the fragment test (#965) — the cull's and the
 *  occlusion test's lists alike (`cullShader.ts`, `KEPT_LISTS_WGSL`). */
export const SHADOW_REGION_COMMANDS = 2,
  SHADOW_REGION_INDIRECT_BYTES = SHADOW_REGION_COMMANDS * DRAW_INDIRECT_STRIDE;
const REGION_WORDS = SHADOW_REGION_COMMANDS * DRAW_INDIRECT_WORDS;
/** The word of the cull's commands after every region's: the casters its regions tested — those
 *  of the kind each draws —, kept or not, zeroed with the batch's commands (`cullCounts.ts`). */
export const SHADOW_TESTED_WORD = MAX_SHADOW_REGIONS * REGION_WORDS;

const EMPTY_COMMANDS = new Uint32Array(MAX_SHADOW_REGIONS * REGION_WORDS);
/** The `regions` first regions' commands, both lists each, at zero instances of zero vertices — the
 *  cull raises each to its largest caster's corners (`keptCorners`, #966) —, to write. */
export const emptyRegionCommands = (regions: number) =>
  EMPTY_COMMANDS.subarray(0, regions * REGION_WORDS);

/** Words of a moving group's entry in the group table (`groupWgsl.ts`): the first word of its
 *  pairs, the end of them, its block and whether its lists are the occlusion test's. The table: a
 *  word per region — its group plus one, 0 when drawn alone —, every group's entry, then the rows
 *  a region's lists hold (`GROUP_CAPACITY_WORD`), then the first blended caster's row
 *  (`GROUP_BLEND_FIRST_WORD`). A batch holds a group per region at most. */
export const GROUP_WORDS = 3,
  GROUP_CAPACITY_WORD = MAX_SHADOW_REGIONS * (1 + GROUP_WORDS),
  GROUP_BLEND_FIRST_WORD = GROUP_CAPACITY_WORD + 1,
  GROUP_TABLE_WORDS = GROUP_CAPACITY_WORD + 2;
/** The word of the moving groups' commands where each group's blended command starts, after
 *  their opaque and cutout ones: one command a group (`SHADOW_GROUP_PAIRS_WGSL`). */
export const GROUP_BLEND_COMMANDS = MAX_SHADOW_REGIONS * REGION_WORDS;

/** The WGSL struct `name` of `words` words: `fields`, one word each, then padding — the host's
 *  word count, never a literal twin of it. */
export const wordStruct = (name: string, fields: readonly string[], words: number) =>
  `struct ${name}{${fields.concat(Array.from({ length: words - fields.length }, (_, i) => `pad${i}:u32`)).join(',')},}`;

/** The most one batch writes through `batchWrites.ts`, writer by writer. */
export const SHADOW_BATCH_WRITE_BYTES =
  DAG_UNIFORM_BYTES +
  MAX_SHADOW_REGIONS * SHADOW_FACE_STRIDE +
  MAX_SHADOW_REGIONS * (SHADOW_CULL_FLOATS * 4 + SHADOW_REGION_INDIRECT_BYTES) +
  MAX_SHADOW_PAGES * CULL_UNIFORM_WORDS * 4 +
  (LIGHT_CULL_UNIFORM_WORDS + LIGHT_CULL_ARG_WORDS) * 4 +
  MAX_SHADOW_REGIONS * (OCCLUSION_SLOT_WORDS * 4 + SHADOW_REGION_INDIRECT_BYTES) +
  OCCLUSION_UNIFORM_WORDS * 4 +
  MAX_SHADOW_PAGES * PAGE_BOUNDS_WORDS * 4 +
  BIN_RUNS * BIN_UNIFORM_WORDS * 4 +
  MAX_SHADOW_REGIONS * 4 +
  4 +
  GROUP_TABLE_WORDS * 4;
/** The staging buffer at the grant: every batch but the first, which writes straight
 *  (`batchWrites.ts`). */
export const SHADOW_STAGING_BYTES = (MAX_SHADOW_BATCHES - 1) * SHADOW_BATCH_WRITE_BYTES;

/**
 * THE BATCHES ONE FRAME MAY DRAW, AND THE STAGING THEY TAKE: every page of the current pool of
 * `poolPages`, in batches that hold at least the fewer of `MAX_SHADOW_PAGES` and the `views` one
 * batch runs — a batch cut ends at either (`admit.ts`, `batchEnd`) —, never past the grant
 * (`MAX_SHADOW_BATCHES`, what the memory budget counts) nor past the staging buffer the device can
 * make (`maxBufferSize`). A bound, never a command: a frame runs only the batches its pages fill.
 */
export function shadowBatchCapacity(poolPages: number, views: number, maxBufferSize: number) {
  const fewest = Math.max(1, Math.min(MAX_SHADOW_PAGES, views)),
    staged = 1 + Math.floor(maxBufferSize / SHADOW_BATCH_WRITE_BYTES),
    batches = Math.max(1, Math.min(Math.ceil(poolPages / fewest), MAX_SHADOW_BATCHES, staged));
  return { batches, stagingBytes: (batches - 1) * SHADOW_BATCH_WRITE_BYTES };
}

/** A frame's flag words on the GPU, and on the host each batch's pages, their views, their caster
 *  bits and where the batch ends (`../dag/lightCutRedraws.ts`). */
const FLAG_GPU_BYTES = MAX_SHADOW_BATCHES * 4,
  FLAG_HOST_BYTES =
    MAX_SHADOW_BATCHES *
      MAX_SHADOW_PAGES *
      (Int32Array.BYTES_PER_ELEMENT + 2 * Uint8Array.BYTES_PER_ELEMENT) +
    MAX_SHADOW_BATCHES * Uint16Array.BYTES_PER_ELEMENT;
/** The CPU cut's per-face offsets, lengths and commands on the host, its commands on the GPU
 *  (`../../webgpu/shadow/cpuCasters.ts`). */
const CPU_RUN_HOST_BYTES = 4 + 4 + DRAW_INDIRECT_STRIDE,
  CPU_RUN_GPU_BYTES = DRAW_INDIRECT_STRIDE;

/** A sampled frame's commands, one a region, every batch's (`cullCounts.ts`), and the commands a
 *  region's samplers copy: the cull's two lists, the occlusion test's hidden count; with the
 *  cull's, each batch's tested word. */
export const SHADOW_COUNT_SAMPLE_BYTES =
  MAX_SHADOW_BATCHES * MAX_SHADOW_REGIONS * DRAW_INDIRECT_STRIDE;
export const SHADOW_TESTED_SAMPLE_BYTES = MAX_SHADOW_BATCHES * 4;
const SHADOW_COUNT_SAMPLED_COMMANDS = SHADOW_REGION_COMMANDS + 1;

/** GPU bytes the batches add, at their largest: staging, flag words, CPU cut commands, and the
 *  cull and occlusion count samples. */
export const SHADOW_BATCH_GPU_BYTES =
  SHADOW_STAGING_BYTES +
  SHADOW_FLAG_FRAMES * FLAG_GPU_BYTES +
  MAX_SHADOW_RUNS * CPU_RUN_GPU_BYTES +
  SHADOW_COUNT_SAMPLED_COMMANDS * SHADOW_COUNT_SAMPLE_BYTES +
  SHADOW_TESTED_SAMPLE_BYTES;
/** Host bytes the batches add, at their largest: the flag frames' pages, the CPU cut's faces, and
 *  the staging buffer's host mirror (`batchWrites.ts`). */
export const SHADOW_BATCH_HOST_BYTES =
  SHADOW_FLAG_FRAMES * FLAG_HOST_BYTES +
  MAX_SHADOW_RUNS * CPU_RUN_HOST_BYTES +
  SHADOW_STAGING_BYTES;
