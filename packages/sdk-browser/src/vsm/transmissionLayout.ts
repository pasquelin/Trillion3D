/**
 * The sizes of the coloured transmission, without a device: the readable memory's width and
 * format, the build buffer's counters and regions, the dispatch arguments, the first capacities
 * and every byte a transmission asks for (`transmissionWgsl.ts` lays the data out,
 * `transmissionPass.ts` makes it). Only constants and arithmetic: the memory budget reads the
 * transmission's share here without the passes (`residency/shadowBudgetBytes.ts`).
 */
import { textureBytesOf } from '../gpu/core/textureBytes.ts';
import { ceilDiv, roundUpPow2, type VsmLayout } from './layout.ts';

/** Texels of a block: 2 048 words, so a sea page's slice (~1 300 words) takes one. */
export const VSM_TRANSMISSION_BLOCK_TEXELS = 512;
/** The readable memory's width in texels: two blocks a row. */
export const VSM_TRANSMISSION_WIDTH = 2 * VSM_TRANSMISSION_BLOCK_TEXELS;
/** The readable memory's format. */
export const VSM_TRANSMISSION_FORMAT: GPUTextureFormat = 'rgba32uint';
/** Bytes of the frame uniform (`VsmTransmissionFrame`). */
export const VSM_TRANSMISSION_UNIFORM_BYTES = 48;
/** Words of a record in the build buffer: its 16, then its slice key, its index in the slice, its
 *  patch's first word in the build buffer, and its cells (`vsmTCellsWord`). */
export const VSM_TRANSMISSION_RECORD_WORDS = 20;

/** The build buffer's counters (`VsmTransmission.build`, its first words), what the feedback reads. */
export const VSM_TRANSMISSION_COUNTERS = {
  slices: 0,
  records: 1,
  patchWords: 2,
  /** Blocks the slices this frame asked for and the pool did not hold. */
  blocksShort: 3,
  /** Slices past `VSM_TRANSMISSION_CHAIN` blocks. */
  full: 4,
  dirty: 5,
} as const;
export const VSM_TRANSMISSION_COUNTER_WORDS = 8;

/** Where each region of the build buffer starts, in words, for `pages` physical pages and the
 *  capacities `caps`: per slice key (two slices a page) its stamp, its first record in the frame's
 *  order, its record and patch-word counts; the frame's slices by number, the dirty list, the order
 *  (each slice's records together), then the records and the patches. */
export function vsmTransmissionRegions(pages: number, caps: VsmTransmissionCaps) {
  const keys = 2 * pages;
  const stamps = VSM_TRANSMISSION_COUNTER_WORDS,
    first = stamps + keys,
    counts = first + keys,
    patchCounts = counts + keys,
    sliceKeys = patchCounts + keys,
    dirty = sliceKeys + keys,
    order = dirty + keys,
    records = order + caps.records,
    patches = records + caps.records * VSM_TRANSMISSION_RECORD_WORDS,
    words = patches + caps.patchWords;
  return { stamps, first, counts, patchCounts, sliceKeys, dirty, order, records, patches, words };
}

/** The build buffer's and the block pool's capacities. */
export interface VsmTransmissionCaps {
  records: number;
  patchWords: number;
  blocks: number;
}

/** Rows of page headers in the memory: four words a texel, two a physical page. */
export const headerRows = (pages: number) =>
  Math.ceil(Math.ceil(pages / 2) / VSM_TRANSMISSION_WIDTH);

/** Words of the dispatch arguments: the place's, the resolve's, the headers'. */
export const VSM_TRANSMISSION_ARGS_WORDS = 9;
/** Bytes into the dispatch arguments of each. */
export const VSM_TRANSMISSION_ARGS_AT = { place: 0, resolve: 12, headers: 24 } as const;

/** The first capacities for `pages` physical pages (the derivation in `transmissionPass.ts`'s
 *  header). */
export function vsmTransmissionFirstCaps(pages: number): VsmTransmissionCaps {
  return {
    records: 64 * pages,
    patchWords: roundUpPow2(130 * 130),
    blocks: pages,
  };
}

/** Blocks two texel rows of the memory hold. */
export const VSM_TRANSMISSION_BLOCKS_A_ROW = 2;

/** The readable memory: the page headers' rows, then two blocks a row. Its bytes do not depend
 *  on `usage`, so they are counted where no WebGPU global exists. */
export function vsmTransmissionMemoryDescriptor(
  layout: VsmLayout,
  blocks: number,
  usage: GPUTextureUsageFlags,
) {
  return {
    label: 'vsm.transmission.memory',
    size: [
      VSM_TRANSMISSION_WIDTH,
      headerRows(layout.poolPages) + ceilDiv(blocks, VSM_TRANSMISSION_BLOCKS_A_ROW),
    ],
    format: VSM_TRANSMISSION_FORMAT,
    usage,
  };
}

/** The feedback copies the build buffer's counters (`VSM_TRANSMISSION_COUNTERS`). */
export const VSM_TRANSMISSION_FEEDBACK_BYTES = VSM_TRANSMISSION_COUNTER_WORDS * 4;

/** Every byte `createVsmTransmission` asks the device for at `caps`: table, pool, links, build
 *  buffer, dispatch arguments, frame uniform, memory, the two feedback copies. */
export function vsmTransmissionBytes(
  layout: VsmLayout,
  caps = vsmTransmissionFirstCaps(layout.poolPages),
) {
  const pages = layout.poolPages;
  return (
    2 * pages * 4 +
    (caps.blocks + 2) * 4 +
    caps.blocks * 4 +
    vsmTransmissionRegions(pages, caps).words * 4 +
    VSM_TRANSMISSION_ARGS_WORDS * 4 +
    VSM_TRANSMISSION_UNIFORM_BYTES +
    textureBytesOf(vsmTransmissionMemoryDescriptor(layout, caps.blocks, 0))! +
    2 * VSM_TRANSMISSION_FEEDBACK_BYTES
  );
}
