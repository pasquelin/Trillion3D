// A small shadow world for the prefiltered distant shadow's kernels, run by `shaderRun`: one row of
// 128 pool pages, a page table of four map blocks, each map's record, and the filtered pools (bytes in
// words, the history), with the accessors a test reads and writes them by. A kernel that shares
// workgroup memory (the separable passes, the merge down) is run a function at a time: its threads'
// loads first, its stores after, as the barrier between them orders them.
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { VSM_PROJECTION_RECORD_WORD as RECORD } from './projection/projectionData.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { VSM_LEVEL0_PAGES, VSM_LEVEL0_TEXELS, VSM_PAGE_TEXELS } from './constants.ts'
import { vsmFilterableKernels } from './filterableWgsl.ts'
import { vsmLayout, type VsmResourceOptions } from './layout.ts'
import {
  VSM_ENTRY_SECONDARY_BIT,
  VSM_FILTERABLE_PAGE_BYTES,
  VSM_FILTERABLE_PAGE_SIZE,
  VSM_FILTER_LIST_FILTERABLE,
  VSM_FILTER_LIST_SEPARABLE,
  VSM_HISTORY_BLEND_WORD,
  vsmHistoryHeader,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'

const POOL_PAGES = 128
const X_PARTS = ['vsmFilterableXLoad', 'vsmFilterableXStore']
const Y_PARTS = ['vsmFilterableYLoad', 'vsmFilterableYStore']
const OPTIONS: VsmResourceOptions = {
  coverMode: 'suns',
  fullMapCapacity: 7,
  sunMapCapacity: 3,
  poolPages: POOL_PAGES,
}
const PAGE_WORDS = VSM_FILTERABLE_PAGE_BYTES / 4
/** The table: four map blocks a row, 128 pages wide; the cover twice as fine. */
const TABLE = [512, 384] as const
const COVER = [1024, 768] as const
/** The history's regions: four ids, the records of four maps, the table and the cover. */
const RECORD_WORDS = 100
/** The words of the header the regions lie behind. */
const HEADER_WORDS = vsmHistoryHeader(vsmHistoryLayout(vsmLayout(OPTIONS)), 0).length
const HISTORY = {
  ids: HEADER_WORDS,
  records: HEADER_WORDS + 4,
  table: HEADER_WORDS + 4 + 4 * RECORD_WORDS,
  cover: HEADER_WORDS + 4 + 4 * RECORD_WORDS + TABLE[0] * TABLE[1],
  words: HEADER_WORDS + 4 + 4 * RECORD_WORDS + TABLE[0] * TABLE[1] + COVER[0] * COVER[1],
}

/** An orthographic map's transform: a unit of the map's frame is a texel, its centre at the UV (½, ½),
 *  the depth as it is. */
export const orthoMap = () => {
  const texel = 1 / VSM_LEVEL0_TEXELS
  return new Mat([texel, 0, 0, 0, 0, texel, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1])
}

export interface MapOptions {
  flags?: number
  /** The clip depths of the map's range: inner, outer. */
  range?: [number, number]
  mapLevel?: number
  levelsLeft?: number
  cornerSteps?: [number, number]
  /** The map's transform to UV; an orthographic one over the whole map by default. */
  to?: Mat
}

export interface PreviousMapOptions extends MapOptions {
  /** The previous frame's transform to UV, its origin shift and the clipmap's origin in its frame. */
  to?: Mat
  shift?: number[]
  origin?: number[]
}

/** The world, its programs and its accessors. */
export function filterableWorld() {
  const kernels = vsmFilterableKernels(vsmLayout({ ...OPTIONS, prefilteredDistant: true }))
  const consts = wgslConstants(kernels.filterableX.code)
  const bytes = () => new Uint32Array(POOL_PAGES * PAGE_WORDS)
  const world = {
    vsm: {
      ...{ poolPages: POOL_PAGES, poolRowShift: 7, poolRowMask: 127 },
      ...{ pageTableSize: [...TABLE], coverSize: [...COVER] },
      coverMipOffset: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    },
    vsmPageTable: new Uint32Array(TABLE[0] * TABLE[1]),
    vsmProjectionData: [] as Record<string, unknown>[],
    vsmPoolPageInfo: Array.from({ length: POOL_PAGES }, () => ({
      ...{ flags: 0, lastWantedStamp: 0, mapId: 0, mipLevel: 0 },
      pageAddress: [0, 0],
    })),
    vsmPool0: new Uint32Array(POOL_PAGES * VSM_PAGE_TEXELS * VSM_PAGE_TEXELS),
    vsmFilterablePages: new Uint32Array(2 * POOL_PAGES),
    vsmFilterableTemp: bytes(),
    vsmFilterableSeparate: bytes(),
    vsmPrevFilterableSeparate: bytes(),
    vsmFilterableMerged: bytes(),
    vsmFilterableHistory: new Uint32Array(HISTORY.words),
    bitcast_i32: (x: number) => x | 0,
    // The workgroup memory of the kernels.
    vsmFilterRow: Array<number>(VSM_PAGE_TEXELS + 4).fill(0),
    vsmBlendGroup: {} as Record<string, unknown>,
    vsmMergePage: Array<number>(32).fill(0),
    vsmMergeBias: Array.from({ length: 32 }, () => [0, 0]),
  }
  const poolOf = (k: number) => [k & 127, k >> 7]
  /** Map `id`: its record, its block of the table at (128 · id, 0). */
  const addMap = (id: number, o: MapOptions = {}) => {
    world.vsmProjectionData[id] = {
      ...{ tableOrigin: VSM_LEVEL0_PAGES * id, finestMip: 0, flags: o.flags ?? 0 },
      ...{ dynamicDepthCullRange: o.range ?? [0.5, 1], mapLevel: o.mapLevel ?? 0 },
      ...{ levelsLeft: o.levelsLeft ?? 1, cornerSteps: o.cornerSteps ?? [0, 0] },
      ...{
        shiftedToMapUv: o.to ?? orthoMap(),
        originShiftHigh: [0, 0, 0],
        originShiftLow: [0, 0, 0],
      },
      ...{ clipmapOrigin: [0, 0, 0], levelBias: 0 },
      // Reverse depth: the view depth is the clip depth, negated.
      lightViewToClip: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]),
    }
  }
  /** Pool page `pool` holds the virtual page `page` of map `map` at its own level; the table says so,
   *  with the secondary bit where asked; `written` leaves its dynamic layer as drawn into. */
  const addPage = (
    pool: number,
    map: number,
    page: [number, number],
    o: { secondary?: boolean; written?: boolean } = {},
  ) => {
    const [x, y] = poolOf(pool)
    const entry = consts.VSM_ENTRY_MAPPED_BIT + consts.VSM_ENTRY_DRAWABLE_BIT
    world.vsmPageTable[tableAt(map, page)] =
      (x | (y << 10) | entry | (o.secondary ? VSM_ENTRY_SECONDARY_BIT : 0)) >>> 0
    const info = world.vsmPoolPageInfo[pool]
    info.mapId = map
    info.pageAddress = [...page]
    info.flags = 1 | (o.written ? 0 : consts.VSM_META_DYNAMIC_CLEARED)
  }
  const tableAt = (map: number, page: [number, number]) =>
    page[1] * TABLE[0] + VSM_LEVEL0_PAGES * map + page[0]
  /** A byte of a pool: texel (x, y) of a page, border included; in the temporary pool, which has no border,
   *  its inner texel (x, y) with a stride of the page's texels. */
  const byteAt = (buffer: Uint32Array, page: number, x: number, y: number) =>
    page * VSM_FILTERABLE_PAGE_BYTES +
    (buffer === world.vsmFilterableTemp
      ? y * VSM_PAGE_TEXELS + x
      : y * VSM_FILTERABLE_PAGE_SIZE + x)
  const getByte = (buffer: Uint32Array, page: number, x: number, y: number) => {
    const b = byteAt(buffer, page, x, y)
    return (buffer[b >> 2] >>> ((b & 3) * 8)) & 255
  }
  const setByte = (buffer: Uint32Array, page: number, x: number, y: number, v: number) => {
    const b = byteAt(buffer, page, x, y)
    const shift = (b & 3) * 8
    buffer[b >> 2] = ((buffer[b >> 2] & ~(255 << shift)) | (v << shift)) >>> 0
  }
  /** The pages the passes work on: list `list` of the page lists. */
  const list = (which: 'separable' | 'filterable', pages: number[]) => {
    const at = which === 'separable' ? VSM_FILTER_LIST_SEPARABLE : VSM_FILTER_LIST_FILTERABLE
    pages.forEach((page, i) => (world.vsmFilterablePages[at * POOL_PAGES + i] = page))
  }
  /** A pool depth at (x, y) of the page at pool address `pool`, as the raster writes it. */
  const setDepth = (pool: number, x: number, y: number, depth: number) => {
    world.vsmPool0[pool * VSM_PAGE_TEXELS * VSM_PAGE_TEXELS + y * VSM_PAGE_TEXELS + x] =
      f32Bits(depth)
  }
  const h = world.vsmFilterableHistory
  h.set([HISTORY.records, HISTORY.table, HISTORY.cover, HISTORY.ids])
  /** The previous frame's map `id` in the history: its record, its block of the table at (128 · id, 0). */
  const addPreviousMap = (id: number, o: PreviousMapOptions = {}) => {
    const at = HISTORY.records + id * RECORD_WORDS
    h[at + RECORD.tableOrigin] = VSM_LEVEL0_PAGES * id
    h[at + RECORD.mapLevel] = o.mapLevel ?? 0
    h[at + RECORD.levelsLeft] = o.levelsLeft ?? 1
    h[at + RECORD.flags] = o.flags ?? 0
    ;(o.to ?? orthoMap()).m.forEach((v, i) => (h[at + RECORD.shiftedToMapUv + i] = f32Bits(v)))
    ;(o.shift ?? [0, 0, 0]).forEach((v, i) => (h[at + RECORD.originShiftHigh + i] = f32Bits(v)))
    ;(o.origin ?? [0, 0, 0]).forEach((v, i) => (h[at + RECORD.clipmapOrigin + i] = f32Bits(v)))
  }
  /** The previous page table's entry of map `map`'s virtual page `page`: pool page `pool`. */
  const addPreviousPage = (map: number, page: [number, number], pool: number, secondary = true) => {
    const [x, y] = poolOf(pool)
    const entry = consts.VSM_ENTRY_MAPPED_BIT + consts.VSM_ENTRY_DRAWABLE_BIT
    h[HISTORY.table + tableAt(map, page)] =
      (x | (y << 10) | entry | (secondary ? VSM_ENTRY_SECONDARY_BIT : 0)) >>> 0
  }
  /** The previous receiver cover of the half page `quadrant` of a page: its 4 x 4 bits `mask`. */
  const addPreviousCover = (
    map: number,
    page: [number, number],
    quadrant: [number, number],
    mask: number,
  ) => {
    const x = 2 * (VSM_LEVEL0_PAGES * map + page[0]) + quadrant[0]
    h[HISTORY.cover + (2 * page[1] + quadrant[1]) * COVER[0] + x] = mask
  }
  const history = {
    /** The blend the filter keeps of the previous frame; map ids `current` came from `previous`. */
    blend: (blend: number) => (h[VSM_HISTORY_BLEND_WORD] = f32Bits(blend)),
    previousId: (current: number, previous: number) => (h[HISTORY.ids + current] = previous + 1),
  }
  /** The pool the border pass of kernel `name` works on. */
  const target = (name: string) =>
    name === 'filterableBorderMerged' ? world.vsmFilterableMerged : world.vsmFilterableSeparate
  type Functions = Record<string, (...a: unknown[]) => unknown>
  const functions = (name: keyof typeof kernels, names: string[]) =>
    shaderRun<Functions>(kernels[name].code, names, {
      ...consts,
      ...world,
      vsmFilterableTarget: target(name),
    })
  /** Kernel `name`, one without workgroup memory, run for the thread `args`' first. */
  const run = <A extends unknown[]>(name: keyof typeof kernels, ...args: A) => {
    const entry = kernels[name].entryPoint
    functions(name, [entry])[entry](...args)
  }
  /** A separable pass for the group `wid` of a dispatch of `count` groups: every thread of the group
   *  loads its texels, then the threads `texels` store theirs. */
  const runLine = (
    name: 'filterableX' | 'filterableY',
    wid: number[],
    count: number[],
    texels: number[],
  ) => {
    const [load, store] = name === 'filterableX' ? X_PARTS : Y_PARTS
    const f = functions(name, ['vsmFilterGroupOf', load, store])
    const group = f.vsmFilterGroupOf(wid, count)
    for (let texel = 0; texel < VSM_PAGE_TEXELS; texel++) f[load](group, texel)
    for (const texel of texels) f[store](group, texel)
  }
  /** The merge down of the tile `wid` of a dispatch of `count`: every thread finds a level's page, then
   *  the threads store their 2 x 2 texels. */
  const runTile = (wid: number[], count: number[]) => {
    const f = functions('filterableMergeDown', [
      'vsmMergeGroupOf',
      'vsmFilterableMergeSource',
      'vsmFilterableMergeStore',
    ])
    const group = f.vsmMergeGroupOf(wid, count)
    for (let lane = 0; lane < 256; lane++) f.vsmFilterableMergeSource(group, lane)
    for (let lane = 0; lane < 256; lane++)
      f.vsmFilterableMergeStore(group, [lane % 16, Math.floor(lane / 16)])
  }
  return {
    ...{ kernels, consts, world, addMap, addPage, getByte, setByte, setDepth, list },
    ...{ history, addPreviousMap, addPreviousPage, addPreviousCover, run, runLine, runTile },
  }
}
