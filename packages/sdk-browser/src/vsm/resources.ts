/**
 * Every GPU buffer of the virtual shadow map system, and the WGSL binding declarations for them.
 *
 * The tables could be allocated per frame for the current map count, extracting the ones the next
 * frame reads. Here they are persistent, sized for a maximum count, and the extracted set is
 * double-buffered: `frames[current]` / `frames[prev]`, swapped by `swapFrames()` at the point the
 * frame data is extracted. The members no pass reads as the previous frame's are one buffer in
 * both frames (`SHARED_FRAME_MEMBERS`). A count above the maximum needs a new
 * `createVsmResources` (which drops the cache).
 *
 * 2D tables are storage buffers of u32, row-major, mips concatenated (see `pageTableWgsl.ts`). The
 * physical pool (R32 texel array, 2 slices) is one buffer per slice, its texels page by page
 * (`vsmPoolTexelIndexWgsl`), split into parts of whole page rows when a slice exceeds
 * `device.limits.maxStorageBufferBindingSize`.
 */
import {
  VSM_PAGE_LIST_COUNT,
  VSM_DIRTY_SLICES,
  VSM_LOG2_PAGE,
  VSM_MIPS,
  VSM_POOL_PAGES,
  VSM_SINGLE_PAGE_MAP_SLOTS,
  VSM_PAGE_TEXELS,
  VSM_LEVEL0_PAGES,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_POOL_SLICES,
  VSM_PROJECTION_RECORD_BYTES,
  VSM_TABLE_ROW_WIDTH,
  VSM_COUNTERS,
  VSM_TILE_DEPTHS_PER_PAGE,
  VSM_COVER_SUN,
  VSM_COVER_LOCAL,
} from './constants.ts';
import { roundUpPow2 } from './passKit.ts';
import { vsmWriteChangedCopy } from './writeChanged.ts';
import { VSM_UNIFORMS_BYTES } from './uniforms.ts';
import type { ShrunkPool } from '../residency/outOfMemory.ts';

type VsmCoverMode = 'local' | 'directional' | 'none';

export interface VsmResourceOptions {
  /** Physical pages of the pool, default 2048; rounded up to whole pool rows. */
  poolPages?: number;
  /** Capacity for full (non single-page) maps: clipmap levels + local light faces. */
  fullMapCapacity: number;
  /** Directional maps (clipmap levels), sizes the directional-only receiver cover. */
  sunMapCapacity?: number;
  /** Receiver cover kind; default from `VSM_COVER_LOCAL` / `VSM_COVER_SUN`. */
  coverMode?: VsmCoverMode;
  /** Separate static cache slice; default true (cache on). */
  cacheEnabled?: boolean;
}

/** Everything derived from the options; also what `writeVsmUniforms` needs. */
export interface VsmLayout {
  poolPages: number;
  poolPagesXY: [number, number];
  poolTexelsXY: [number, number];
  poolRowShift: number;
  poolRowMask: number;
  staticSlice: number;
  fullMapCapacity: number;
  mapSlots: number;
  pageTableRowShift: number;
  pageTableRowMask: number;
  pageTableRows: number;
  /** Level-0 texel size of page table / page marks / request flags. */
  pageTableSize: [number, number];
  pageTableWords: number;
  /** The page marks: VSM_LOG2_PAGE mips. */
  markMips: number;
  markMipOffsets: number[];
  markWordCount: number;
  coverMode: VsmCoverMode;
  coverSize: [number, number];
  coverMips: number;
  coverMipOffsets: number[];
  coverWords: number;
  /** The slot count · 8 (one rect per mip), rounded up to a power of two. */
  pageRectCount: number;
  /** Physical pool: page rows per binding part, parts per slice, log2 texels per part. */
  poolPageRowsPerPart: number;
  poolPartsPerSlice: number;
  poolPartTexelShift: number;
}

/** One frame's buffers; `pageTable`, `receiverCover` and `staleRects` are the same
 *  buffer in both frames (`SHARED_FRAME_MEMBERS`). */
export interface VsmFrameBuffers {
  uniforms: GPUBuffer;
  pageTable: GPUBuffer;
  pageMarks: GPUBuffer;
  receiverCover: GPUBuffer;
  pageRequests: GPUBuffer;
  staleRects: GPUBuffer;
  mappedRects: GPUBuffer;
  projectionData: GPUBuffer;
  poolLists: GPUBuffer;
}

/**
 * The frame members no pass binds as the previous frame's: one buffer serves both frames. Each
 * frame clears what it reads of them before reading it (the page table and receiver covers of its
 * maps, the rects of its map count), so last frame's content is never seen. A depth pyramid of the
 * maps (P10) reads last frame's page table: it splits them again.
 */
const SHARED_FRAME_MEMBERS: ReadonlySet<string> = new Set<keyof VsmFrameBuffers>([
  'pageTable',
  'receiverCover',
  'staleRects',
]);

export interface VsmResources {
  layout: VsmLayout;
  frames: [VsmFrameBuffers, VsmFrameBuffers];
  current: VsmFrameBuffers;
  prev: VsmFrameBuffers;
  /** Persistent, updated in place by the physical page address update (one buffer in both frames). */
  poolPageInfo: GPUBuffer;
  /** The raster marks: a word per pool page in each of `VSM_DIRTY_SLICES` slices, slice by slice. */
  rasterMarks: GPUBuffer;
  /** The next-map data, indexed by the previous frame's id. */
  nextMaps: GPUBuffer;
  /** [slice][part], slice 0 dynamic, 1 static. */
  pagePool: GPUBuffer[][];
  /** Per physical page, the closest depth (the greatest word, read as a float) of each of its
   *  8×8-texel tiles of slice 0 (`VSM_LOG2_TILE_DEPTH_TEXELS`), rebuilt where a page changed
   *  (`vsmTileDepthsBuild`): what the sun's rays prove they miss against
   *  (`vsmSunRayMisses`). Made with the pool, both zero: a page never written holds 0. */
  tileDepths: GPUBuffer;
  /** The `VSM_COUNTERS` counters. */
  stats: GPUBuffer;
  /** The feedback status: [message id, free pages, pressure bias bits, scene frame]. */
  feedback: GPUBuffer;
  /** The per-page dispatcher ids, sorted by bin. */
  perPageIds: GPUBuffer;
  /** 2·poolPages + 1 words per list. */
  pagesToClear: GPUBuffer;
  pagesToMerge: GPUBuffer;
  pagesForTiles: GPUBuffer;
  /** Indirect dispatch args: 1D, post-process 2×(x,y,z,count), tile depths 2×4. */
  clearArgs: GPUBuffer;
  mergeArgs: GPUBuffer;
  tileArgs: GPUBuffer;
  /** Whether the cache data is available: prev buffers hold a frame extracted with caching on
   *  (`keepVsmFrame`). */
  prevFrameKept: boolean;
  /** Extraction point: the frame just rendered becomes `prev`. */
  swapFrames(): void;
  destroy(): void;
  bytes: number;
}

const floorLog2 = (v: number) => 31 - Math.clz32(v);
const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

function mipChain(width: number, height: number, mips: number) {
  const offsets: number[] = [];
  let words = 0;
  for (let m = 0; m < mips; m++) {
    offsets.push(words);
    words += Math.max(1, width >>> m) * Math.max(1, height >>> m);
  }
  return { offsets, words };
}

/** Pure sizing; no device needed except for the binding limit. */
export function vsmLayout(
  options: VsmResourceOptions,
  maxStorageBufferBindingSize: number,
): VsmLayout {
  const maxDim = VSM_TABLE_ROW_WIDTH;
  const cacheEnabled = options.cacheEnabled ?? true;
  // The physical pool: fixed power-of-two row width, height for the requested page count.
  const physicalPagesX = Math.floor(maxDim / VSM_PAGE_TEXELS);
  if (!isPow2(physicalPagesX)) throw new Error('VSM: pool row must be a power of two pages');
  const physicalPagesY = Math.ceil(
    Math.max(1, options.poolPages ?? VSM_POOL_PAGES) / physicalPagesX,
  );
  const poolPages = physicalPagesX * physicalPagesY;
  const poolTexelsXY: [number, number] = [
    physicalPagesX * VSM_PAGE_TEXELS,
    physicalPagesY * VSM_PAGE_TEXELS,
  ];

  // The page table: (maxDim/2)/128 tables per row, one extra entry for the single-page block.
  const maxFull = Math.max(0, options.fullMapCapacity);
  const entriesPerRow = Math.floor(maxDim / 2 / VSM_LEVEL0_PAGES);
  if (!isPow2(entriesPerRow)) throw new Error('VSM: page table row must be a power of two tables');
  const pageTableRows = Math.ceil((maxFull + 1) / entriesPerRow);
  const pageTableSize: [number, number] = [
    entriesPerRow * VSM_LEVEL0_PAGES,
    pageTableRows * VSM_PAGE_TABLE_BLOCK_HEIGHT,
  ];
  // The page marks carry VSM_LOG2_PAGE mips.
  const markMips = VSM_LOG2_PAGE;
  const flags = mipChain(pageTableSize[0], pageTableSize[1], markMips);

  const coverMode: VsmCoverMode =
    options.coverMode ?? (VSM_COVER_LOCAL ? 'local' : VSM_COVER_SUN ? 'directional' : 'none');
  let coverSize: [number, number], coverMips: number;
  if (coverMode === 'local') {
    // A full page table at sample stride 2: 7 + 1 mips.
    coverSize = [pageTableSize[0] * 2, pageTableSize[1] * 2];
    coverMips = VSM_LOG2_PAGE + 1;
  } else if (coverMode === 'directional') {
    // Directional maps (+1 single-page entry), a full row only past one row.
    const required = Math.max(0, options.sunMapCapacity ?? maxFull) + 1;
    const rows = Math.ceil(required / entriesPerRow);
    const rowEntries = rows === 1 ? required : entriesPerRow;
    coverSize = [2 * rowEntries * VSM_LEVEL0_PAGES, 2 * rows * VSM_PAGE_TABLE_BLOCK_HEIGHT];
    coverMips = VSM_LOG2_PAGE + 1;
  } else {
    // A 1x1 stand-in for the absent mask.
    coverSize = [1, 1];
    coverMips = 1;
  }
  const masks = mipChain(coverSize[0], coverSize[1], coverMips);

  const mapSlots = VSM_SINGLE_PAGE_MAP_SLOTS + maxFull;

  // Pool parts: whole page rows, a power of two of them, each part within the binding limit.
  const rowWords = poolTexelsXY[0] * VSM_PAGE_TEXELS;
  const rowsFit = Math.floor(maxStorageBufferBindingSize / (rowWords * 4));
  if (rowsFit < 1)
    throw new Error('VSM: one physical page row exceeds maxStorageBufferBindingSize');
  const poolPageRowsPerPart = Math.min(2 ** floorLog2(rowsFit), roundUpPow2(physicalPagesY));
  const poolPartsPerSlice = Math.ceil(physicalPagesY / poolPageRowsPerPart);

  return {
    poolPages,
    poolPagesXY: [physicalPagesX, physicalPagesY],
    poolTexelsXY,
    poolRowShift: floorLog2(physicalPagesX),
    poolRowMask: physicalPagesX - 1,
    staticSlice: cacheEnabled ? 1 : 0,
    fullMapCapacity: maxFull,
    mapSlots,
    pageTableRowShift: floorLog2(entriesPerRow),
    pageTableRowMask: entriesPerRow - 1,
    pageTableRows,
    pageTableSize,
    pageTableWords: pageTableSize[0] * pageTableSize[1],
    markMips,
    markMipOffsets: flags.offsets,
    markWordCount: flags.words,
    coverMode,
    coverSize,
    coverMips,
    coverMipOffsets: masks.offsets,
    coverWords: masks.words,
    pageRectCount: roundUpPow2(mapSlots * VSM_MIPS),
    poolPageRowsPerPart,
    poolPartsPerSlice,
    poolPartTexelShift: floorLog2(poolPageRowsPerPart * rowWords),
  };
}

/**
 * The WGSL function `name` giving the word of pool texel t = (x, y) in its slice: page by page.
 * Page (px, py) fills the words [k·P², (k+1)·P²), k = (py << R) | px, P the page side and R =
 * `poolRowShift` = log2(pages a row), passed as `rowShift`, its WGSL expression (a literal
 * of the layout, or the uniform where a module is built without one); the page's texels row by
 * row inside. Two texels one row apart in a page are one page row of words apart (512 bytes),
 * where a slice laid row by row put them a whole pool row apart (64 KiB at 128 pages a row). Page
 * rows stay whole and in order: a binding part (`poolPartTexelShift`) holds the pages it held.
 * A buffer has no driver tiling; it is laid out as this says.
 */
export function vsmPoolTexelIndexWgsl(name: string, rowShift: string) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1;
  return `fn ${name}(t:vec2u)->u32{return ((((t.y>>${L}u)<<${rowShift})|(t.x>>${L}u))<<${2 * L}u)|((t.y&${M}u)<<${L}u)|(t.x&${M}u);}`;
}

const S = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

/** What a buffer asked for `size` bytes is made at: whole words, never under 16 bytes. */
const bufferBytes = (size: number) => Math.max(16, Math.ceil(size / 4) * 4);

/** The bytes asked for each buffer of one frame (`VsmFrameBuffers`), in creation order. */
function frameBufferSizes(layout: VsmLayout): Record<keyof VsmFrameBuffers, number> {
  return {
    uniforms: VSM_UNIFORMS_BYTES,
    pageTable: layout.pageTableWords * 4,
    pageMarks: layout.markWordCount * 4,
    receiverCover: layout.coverWords * 4,
    pageRequests: layout.pageTableWords * 4,
    staleRects: layout.pageRectCount * 16,
    mappedRects: layout.pageRectCount * 16,
    projectionData: layout.mapSlots * VSM_PROJECTION_RECORD_BYTES,
    poolLists: VSM_PAGE_LIST_COUNT * (layout.poolPages + 1) * 4,
  };
}

/** The buffers made once for both frames and sized by the pool: their names and the bytes asked
 *  for each. */
type VsmSetBuffer =
  | 'poolPageInfo'
  | 'rasterMarks'
  | 'stats'
  | 'feedback'
  | 'pagesToClear'
  | 'pagesToMerge'
  | 'pagesForTiles'
  | 'tileDepths'
  | 'clearArgs'
  | 'mergeArgs'
  | 'tileArgs';

function setBufferSizes(layout: VsmLayout): Record<VsmSetBuffer, number> {
  const maxPages = layout.poolPages;
  return {
    poolPageInfo: maxPages * 24,
    rasterMarks: maxPages * VSM_DIRTY_SLICES * 4,
    stats: VSM_COUNTERS * 4,
    feedback: 16,
    pagesToClear: (2 * maxPages + 1) * 4,
    pagesToMerge: (2 * maxPages + 1) * 4,
    pagesForTiles: (2 * maxPages + 1) * 4,
    tileDepths: maxPages * VSM_TILE_DEPTHS_PER_PAGE * 4,
    clearArgs: 16,
    mergeArgs: 2 * 16,
    tileArgs: 2 * 16,
  };
}

/** The buffers made once for both frames and sized by the maps (`growVsmTables`). */
const tableBufferSizes = (layout: VsmLayout) => ({
  nextMaps: layout.mapSlots * 16,
  perPageIds: layout.mapSlots * 4,
});

/** The bytes asked for each part of one pool slice: whole page rows, the last part the rest. */
function poolPartSizes(layout: VsmLayout) {
  const rowWords = layout.poolTexelsXY[0] * VSM_PAGE_TEXELS;
  return Array.from({ length: layout.poolPartsPerSlice }, (_, p) => {
    const rows = Math.min(
      layout.poolPageRowsPerPart,
      layout.poolPagesXY[1] - p * layout.poolPageRowsPerPart,
    );
    return rows * rowWords * 4;
  });
}

/**
 * The GPU bytes `createVsmResources` makes for `layout`, without a device: every buffer once, the
 * double-buffered frame members twice, the shared ones once (`res.bytes` of the same layout).
 */
export function vsmResourceBytes(layout: VsmLayout) {
  let bytes = vsmTableBytes(layout);
  for (const size of poolPartSizes(layout)) bytes += VSM_POOL_SLICES * bufferBytes(size);
  for (const size of Object.values(setBufferSizes(layout))) bytes += bufferBytes(size);
  return bytes;
}

/** The GPU bytes of the tables of `layout` (`growVsmTables`): both frames' buffers and the
 *  buffers sized by the maps. */
export function vsmTableBytes(layout: VsmLayout) {
  let bytes = 0;
  for (const [member, size] of Object.entries(frameBufferSizes(layout)))
    bytes += bufferBytes(size) * (SHARED_FRAME_MEMBERS.has(member) ? 1 : 2);
  for (const size of Object.values(tableBufferSizes(layout))) bytes += bufferBytes(size);
  return bytes;
}

/** A set drawn within a byte budget (`vsmPoolWithin`): its layout, and the bytes it holds. */
type VsmPool = ShrunkPool & { layout: VsmLayout };

/**
 * The set of `options` that `budgetBytes` holds, as a page pool under pressure is
 * held whole and its pages made coarser: the
 * most physical pages among `options.poolPages` (2048 by default) and its halves down to an
 * eighth whose every buffer fits (`vsmResourceBytes`); `undefined` when not even the eighth does.
 * A pool short of the pages asked is `ceiling`, `minimum` at the eighth.
 */
export function vsmPoolWithin(
  budgetBytes: number,
  options: VsmResourceOptions,
  maxStorageBufferBindingSize: number,
): VsmPool | undefined {
  const asked = options.poolPages ?? VSM_POOL_PAGES;
  for (let pages = asked; pages >= asked / 8; pages /= 2) {
    const layout = vsmLayout({ ...options, poolPages: pages }, maxStorageBufferBindingSize);
    const allocatedBytes = vsmResourceBytes(layout);
    if (allocatedBytes > budgetBytes) continue;
    const clamp = pages === asked ? null : pages <= asked / 8 ? 'minimum' : 'ceiling';
    return { layout, budgetBytes, allocatedBytes, clamp };
  }
  return undefined;
}

/** A set's buffers, to free: those its tables take (`growVsmTables`), and the rest. */
const madeBuffers = new WeakMap<VsmResources, { tables: GPUBuffer[]; rest: GPUBuffer[] }>();

/** Makes `size` bytes labelled `vsm.<label>`, into `into`. */
const makeBuffer = (
  device: GPUDevice,
  into: GPUBuffer[],
  label: string,
  size: number,
  usage = S(),
) => {
  const b = device.createBuffer({ label: `vsm.${label}`, size: bufferBytes(size), usage });
  into.push(b);
  return b;
};

/** Both frames' buffers and those sized by the maps, of `layout`, made into `made`. */
function createVsmTables(device: GPUDevice, layout: VsmLayout, made: GPUBuffer[]) {
  const buffer = (label: string, size: number, usage?: GPUBufferUsageFlags) =>
    makeBuffer(device, made, label, size, usage);
  const frameSizes = frameBufferSizes(layout);
  // Frame `k`'s buffers; the second frame takes the first's shared members, made once. The
  // uniforms are a copy source, as every member a table growth carries (`growVsmTables`).
  const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const frame = (k: number, first?: VsmFrameBuffers) => {
    const buffers = {} as VsmFrameBuffers;
    for (const [member, size] of Object.entries(frameSizes) as [keyof VsmFrameBuffers, number][]) {
      const shared = SHARED_FRAME_MEMBERS.has(member);
      buffers[member] =
        first && shared
          ? first[member]
          : member === 'uniforms'
            ? buffer(`${member}${k}`, size, uniform)
            : buffer(shared ? member : `${member}${k}`, size);
    }
    return buffers;
  };
  const first = frame(0);
  const frames: [VsmFrameBuffers, VsmFrameBuffers] = [first, frame(1, first)];
  const sizes = tableBufferSizes(layout);
  return {
    frames,
    nextMaps: buffer('nextMaps', sizes.nextMaps),
    perPageIds: buffer('perPageIds', sizes.perPageIds),
  };
}

const bytesOf = (buffers: readonly GPUBuffer[]) => buffers.reduce((n, b) => n + b.size, 0);

export function createVsmResources(device: GPUDevice, options: VsmResourceOptions): VsmResources {
  const layout = vsmLayout(options, device.limits.maxStorageBufferBindingSize);
  const tableBuffers: GPUBuffer[] = [],
    rest: GPUBuffer[] = [];
  const buffer = (label: string, size: number, usage?: GPUBufferUsageFlags) =>
    makeBuffer(device, rest, label, size, usage);
  const { frames, nextMaps, perPageIds } = createVsmTables(device, layout, tableBuffers);

  const parts = poolPartSizes(layout);
  const pagePool = Array.from({ length: VSM_POOL_SLICES }, (_, s) =>
    parts.map((size, p) => buffer(`physicalPool${s}.${p}`, size)),
  );

  const indirect = GPUBufferUsage.INDIRECT | S();
  const once = setBufferSizes(layout);
  const res: VsmResources = {
    layout,
    frames,
    current: frames[0],
    prev: frames[1],
    poolPageInfo: buffer('poolPageInfo', once.poolPageInfo),
    rasterMarks: buffer('rasterMarks', once.rasterMarks),
    nextMaps,
    pagePool,
    stats: buffer('stats', once.stats),
    feedback: buffer('feedback', once.feedback),
    perPageIds,
    pagesToClear: buffer('pagesToClear', once.pagesToClear),
    pagesToMerge: buffer('pagesToMerge', once.pagesToMerge),
    pagesForTiles: buffer('pagesForTiles', once.pagesForTiles),
    tileDepths: buffer('tileDepths', once.tileDepths),
    clearArgs: buffer('clearArgs', once.clearArgs, indirect),
    mergeArgs: buffer('mergeArgs', once.mergeArgs, indirect),
    tileArgs: buffer('tileArgs', once.tileArgs, indirect),
    prevFrameKept: false,
    swapFrames() {
      const c = res.current;
      res.current = res.prev;
      res.prev = c;
    },
    destroy() {
      const made = madeBuffers.get(res)!;
      for (const b of [...made.tables, ...made.rest]) b.destroy();
    },
    bytes: bytesOf(tableBuffers) + bytesOf(rest),
  };
  madeBuffers.set(res, { tables: tableBuffers, rest });
  return res;
}

/** The members a frame reads as the previous one's, none shared: what a table growth carries. */
const CARRIED_MEMBERS = [
  'uniforms',
  'pageMarks',
  'pageRequests',
  'mappedRects',
  'projectionData',
  'poolLists',
] as const;

/**
 * The tables of `res` grown in place to `options` — more full maps, the receiver cover of more
 * suns —, the pool and every buffer it sizes kept: the same pages, and their cache. The previous
 * frame's members are copied whole into the new ones' prefix: a full map's id (from
 * `VSM_SINGLE_PAGE_MAP_SLOTS` up) keeps its rows, as the page table's width is fixed, and
 * the pass that reads the previous frame's levels reads them by that frame's own uniforms, carried
 * too (`VSM_INVALIDATION_SPECS`). The shared members, cleared before each read, and the buffers
 * the plan writes every frame are not carried. Only the old tables are freed. `undefined`, and
 * nothing made, when `options` asks no more than `res` holds. A refused buffer leaves `res` as it
 * was (the caller's `constructGpuResources` frees what was made).
 */
export function growVsmTables(
  device: GPUDevice,
  res: VsmResources,
  options: VsmResourceOptions,
): VsmLayout | undefined {
  const held = res.layout;
  const layout = vsmLayout(
    { ...options, poolPages: held.poolPages },
    device.limits.maxStorageBufferBindingSize,
  );
  if (layout.fullMapCapacity <= held.fullMapCapacity && layout.coverWords <= held.coverWords)
    return undefined;
  const made = madeBuffers.get(res)!;
  const tableBuffers: GPUBuffer[] = [];
  const tables = createVsmTables(device, layout, tableBuffers);
  const parity = res.current === res.frames[0] ? 0 : 1;
  const prev = tables.frames[1 - parity];
  const encoder = device.createCommandEncoder({ label: 'vsm.growTables' });
  for (const member of CARRIED_MEMBERS) {
    encoder.copyBufferToBuffer(res.prev[member], 0, prev[member], 0, res.prev[member].size);
    // An upload that sends only what changed (`vsmWriteChanged`) knows what the copy holds.
    vsmWriteChangedCopy(res.prev[member], prev[member]);
  }
  device.queue.submit([encoder.finish()]);
  for (const b of made.tables) b.destroy();
  made.tables = tableBuffers;
  res.layout = layout;
  res.frames = tables.frames;
  res.current = tables.frames[parity];
  res.prev = prev;
  res.nextMaps = tables.nextMaps;
  res.perPageIds = tables.perPageIds;
  res.bytes = bytesOf(tableBuffers) + bytesOf(made.rest);
  return layout;
}

// ---- Binding builder ------------------------------------------------------------------------

/** 'atomic' declares array<atomic<...>> (atomic or / min / max / add users). */
type VsmAccess = 'read' | 'read_write' | 'atomic';

type VsmBindingResource =
  | 'uniforms'
  | 'pageTable'
  | 'pageMarks'
  | 'receiverCover'
  | 'pageRequests'
  | 'staleRects'
  | 'mappedRects'
  | 'projectionData'
  | 'poolLists'
  | 'poolPageInfo'
  | 'rasterMarks'
  | 'nextMaps'
  | 'pagePool'
  | 'stats'
  | 'feedback'
  | 'perPageIds'
  | 'pagesToClear'
  | 'pagesToMerge'
  | 'pagesForTiles'
  | 'tileDepths'
  | 'clearArgs'
  | 'mergeArgs'
  | 'tileArgs';

export interface VsmBindingSpec {
  resource: VsmBindingResource;
  /** First binding number; the pool takes `slices · parts` consecutive numbers. */
  binding: number;
  access?: VsmAccess;
  /** Previous-frame buffer of a double-buffered resource. */
  prev?: boolean;
  /** WGSL variable name; default `vsm<Resource>` (`vsmPrev<Resource>` for prev), uniforms `vsm`/`vsmPrev`. */
  name?: string;
}

const FRAME_RESOURCES = new Set<VsmBindingResource>([
  'uniforms',
  'pageTable',
  'pageMarks',
  'receiverCover',
  'pageRequests',
  'staleRects',
  'mappedRects',
  'projectionData',
  'poolLists',
]);

/** Resources read through `<name>Load(index)` (2D tables and flat u32 arrays). */
const U32_TABLES = new Set<VsmBindingResource>([
  'pageTable',
  'pageMarks',
  'receiverCover',
  'pageRequests',
  'rasterMarks',
  'stats',
  'feedback',
  'perPageIds',
  'pagesToClear',
  'pagesToMerge',
  'pagesForTiles',
  'tileDepths',
  'clearArgs',
  'mergeArgs',
  'tileArgs',
]);

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function varName(spec: VsmBindingSpec) {
  if (spec.name) return spec.name;
  if (spec.resource === 'uniforms') return spec.prev ? 'vsmPrev' : 'vsm';
  if (spec.resource === 'pagePool') return 'vsmPool';
  return (spec.prev ? 'vsmPrev' : 'vsm') + cap(spec.resource);
}

function elementType(resource: VsmBindingResource, atomic: boolean) {
  switch (resource) {
    case 'poolLists':
      return atomic ? 'atomic<i32>' : 'i32';
    case 'staleRects':
    case 'mappedRects':
      // Atomic users address .x/.y/.z/.w as 4·rect + component (atomic min / max).
      return atomic ? 'atomic<u32>' : 'vec4u';
    case 'projectionData':
      return 'VsmProjectionRecord';
    case 'poolPageInfo':
      return 'VsmPoolPageInfo';
    case 'nextMaps':
      return 'VsmNextMap';
    default:
      return atomic ? 'atomic<u32>' : 'u32';
  }
}

/**
 * WGSL declarations (and loaders) for `specs` in `group`. Emits, per u32 table named N:
 * `fn NLoad(i:u32)->u32`, plus `NStore(i,v)` when writable and `NOr(i,v)->u32` when atomic.
 * The pool emits `vsmPoolLoad(texel:vec2u,slice:u32)->u32`, and when writable `vsmPoolStore`,
 * and when atomic `vsmPoolAtomicMax(texel,slice,value)` (the raster's atomic max: a value no
 * greater than the word already held writes nothing, the word being the same).
 * Structs used by the declarations come from `VSM_UNIFORMS_WGSL`, `VSM_PROJECTION_DATA_WGSL`,
 * `VSM_STRUCTS_WGSL`, which the caller includes once.
 */
export function vsmBindingsWgsl(
  group: number,
  specs: readonly VsmBindingSpec[],
  layout: VsmLayout,
) {
  const out: string[] = [];
  for (const spec of specs) {
    // Both frames hold one buffer of a shared member: its previous frame's content is gone.
    if (spec.prev && SHARED_FRAME_MEMBERS.has(spec.resource))
      throw new Error(`VSM: ${spec.resource} keeps no previous frame`);
    const access = spec.access ?? 'read';
    const atomic = access === 'atomic';
    const space = access === 'read' ? 'storage,read' : 'storage,read_write';
    const name = varName(spec);
    if (spec.resource === 'uniforms') {
      out.push(`@group(${group}) @binding(${spec.binding}) var<uniform> ${name}:VsmUniforms;`);
      continue;
    }
    if (spec.resource === 'pagePool') {
      out.push(vsmPoolWgsl(group, spec.binding, access, layout, name));
      continue;
    }
    out.push(
      `@group(${group}) @binding(${spec.binding}) var<${space}> ${name}:array<${elementType(spec.resource, atomic)}>;`,
    );
    if (U32_TABLES.has(spec.resource)) {
      out.push(
        atomic
          ? `fn ${name}Load(i:u32)->u32{return atomicLoad(&${name}[i]);}\nfn ${name}Store(i:u32,v:u32){atomicStore(&${name}[i],v);}\nfn ${name}Or(i:u32,v:u32)->u32{return atomicOr(&${name}[i],v);}`
          : access === 'read_write'
            ? `fn ${name}Load(i:u32)->u32{return ${name}[i];}\nfn ${name}Store(i:u32,v:u32){${name}[i]=v;}`
            : `fn ${name}Load(i:u32)->u32{return ${name}[i];}`,
      );
    }
  }
  return out.join('\n');
}

function vsmPoolWgsl(
  group: number,
  first: number,
  access: VsmAccess,
  layout: VsmLayout,
  name: string,
) {
  const atomic = access === 'atomic';
  const space = access === 'read' ? 'storage,read' : 'storage,read_write';
  const parts = layout.poolPartsPerSlice;
  const lines: string[] = [];
  const vars: string[] = [];
  for (let s = 0; s < VSM_POOL_SLICES; s++)
    for (let p = 0; p < parts; p++) {
      const v = `${name}${s}_${p}`;
      vars.push(v);
      lines.push(
        `@group(${group}) @binding(${first + s * parts + p}) var<${space}> ${v}:array<${atomic ? 'atomic<u32>' : 'u32'}>;`,
      );
    }
  const shift = layout.poolPartTexelShift;
  const mask = `${(2 ** shift - 1) >>> 0}u`;
  // One accessor: the texel's part by slice and word, `body` on that part's array.
  const accessor = (signature: string, body: (v: string) => string, otherwise: string) =>
    `fn ${name}${signature}{\n let l=${name}TexelIndex(t);\n let i=l&${mask};\n switch(slice*${parts}u+(l>>${shift}u)){\n${vars
      .map((v, k) => ` case ${k}u:{${body(v)}}`)
      .join('\n')}\n default:{${otherwise}}\n }\n}`;
  // Texture2DArray texel (x, y, slice): its word in the slice, page by page.
  lines.push(vsmPoolTexelIndexWgsl(`${name}TexelIndex`, `${layout.poolRowShift}u`));
  lines.push(
    accessor(
      'Load(t:vec2u,slice:u32)->u32',
      (v) => (atomic ? `return atomicLoad(&${v}[i]);` : `return ${v}[i];`),
      'return 0u;',
    ),
  );
  if (access !== 'read')
    lines.push(
      accessor(
        'Store(t:vec2u,slice:u32,value:u32)',
        (v) => (atomic ? `atomicStore(&${v}[i],value);` : `${v}[i]=value;`),
        '',
      ),
    );
  if (atomic)
    lines.push(
      accessor(
        'AtomicMax(t:vec2u,slice:u32,value:u32)',
        // A word only grows: one already at least \`value\` stays as the max would leave it.
        (v) => `if(atomicLoad(&${v}[i])<value){atomicMax(&${v}[i],value);}`,
        '',
      ),
    );
  return lines.join('\n');
}

/** Number of binding slots a spec consumes. */
function vsmBindingCount(spec: VsmBindingSpec, layout: VsmLayout) {
  return spec.resource === 'pagePool' ? VSM_POOL_SLICES * layout.poolPartsPerSlice : 1;
}

/** Bind group layout entries matching `vsmBindingsWgsl`. */
export function vsmBindGroupLayoutEntries(
  specs: readonly VsmBindingSpec[],
  layout: VsmLayout,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  const out: GPUBindGroupLayoutEntry[] = [];
  for (const spec of specs) {
    const type: GPUBufferBindingType =
      spec.resource === 'uniforms'
        ? 'uniform'
        : (spec.access ?? 'read') === 'read'
          ? 'read-only-storage'
          : 'storage';
    for (let k = 0; k < vsmBindingCount(spec, layout); k++)
      out.push({ binding: spec.binding + k, visibility, buffer: { type } });
  }
  return out;
}

/** Bind group entries matching `vsmBindingsWgsl`, using `res.current` / `res.prev` at call time. */
export function vsmBindGroupEntries(
  res: VsmResources,
  specs: readonly VsmBindingSpec[],
): GPUBindGroupEntry[] {
  const out: GPUBindGroupEntry[] = [];
  for (const spec of specs) {
    if (spec.resource === 'pagePool') {
      res.pagePool
        .flat()
        .forEach((buffer, k) => out.push({ binding: spec.binding + k, resource: { buffer } }));
      continue;
    }
    const buffer = FRAME_RESOURCES.has(spec.resource)
      ? (spec.prev ? res.prev : res.current)[spec.resource as keyof VsmFrameBuffers]
      : (res[spec.resource as keyof VsmResources] as GPUBuffer);
    out.push({ binding: spec.binding, resource: { buffer } });
  }
  return out;
}

/** What `make(res, arg)` builds over the tables of the frame set `res.current`, made once a set —
 *  the two sets in turn; a set made again (`growVsmTables`) makes its own — and kept in `held`.
 *  `make` and `arg` are the caller's own, so that a frame allocates nothing to ask. */
export function vsmPerFrameSet<T, A>(
  held: WeakMap<VsmFrameBuffers, T>,
  res: VsmResources,
  make: (res: VsmResources, arg: A) => T,
  arg: A,
) {
  let value = held.get(res.current);
  if (value === undefined) held.set(res.current, (value = make(res, arg)));
  return value;
}
