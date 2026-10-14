import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock, wgslConst, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import type { VsmLayout } from './layout.ts'
import {
  headerRows,
  VSM_TRANSMISSION_BLOCK_TEXELS,
  VSM_TRANSMISSION_COUNTERS,
  VSM_TRANSMISSION_RECORD_WORDS,
  vsmTransmissionRegions,
  VSM_TRANSMISSION_WIDTH,
} from './transmissionLayout.ts'

/**
 * Coloured shadows through translucent casters on top of the virtual shadow maps: the plain VSM
 * casts no shadow from a translucent material, the engine does.
 *
 * Nothing is drawn in texels. For each physical page and slice the VSM redraws, the translucent
 * triangles that cover it are binned into 16 × 16 cells of 8 × 8 texels; a receiver then tests the
 * ray toward the light exactly against the two to four triangles of its cell. The class-2 contract
 * (declared): every opaque shadow identical; inside a one-layer area the triangle's quantised
 * transmittance, as the texel store had it; edges at the exact geometric boundary; with several
 * layers only those above the receiver; a translucent receiver never shadows itself.
 *
 * Cell size, derived: a triangle of side s texels meets about 2·(1 + c/s)·(1 + c/(s·sin e)) cells
 * of side c (e the light's elevation over its plane), and a slice's cell headers take (128/c)²
 * words. The sea's triangles are 50 to 100 texels a side, a 10-pixel triangle 25 to 50: c = 8 gives
 * 2.4 to 3.5 tests a receiver for 256 header words (1 KiB); c = 4 saves a third of the tests for
 * four times the header, c = 16 doubles them.
 *
 * A slice's data, in texels (4 words) of its own virtual sequence spread over blocks of
 * `VSM_TRANSMISSION_BLOCK_TEXELS`: 64 texels of cell headers (offset in texels << 16 | count), 8
 * texels of block chain (`VSM_TRANSMISSION_CHAIN` block numbers), the records (4 texels each), the
 * cell lists (a record's texel address a word, each list padded to a texel), then the patches of
 * textured casters (a quantised transmittance a word at each texel centre). A record:
 *   texel 0: x0 y0 x1 y1 — the corners in texels of the page, from its corner;
 *   texel 1: x2 y2 then, directional, d0 d1 (each corner's world position along the map's unit
 *            axis toward the light), local, the plane normal's x y in light-relative space;
 *   texel 2: directional d2, 0; local n.z, plane offset w; then the quantised transmittance q
 *            (bit 24: textured, read from its patch) and the row;
 *   texel 3: the patch: its first word in the slice, its first texel + 1 (x | y << 16), its size.
 *
 * The readable memory is one rgba32uint texture `VSM_TRANSMISSION_WIDTH` texels wide: first the
 * page headers (each physical page's first block of its dynamic and static slice, `NONE` for
 * none, four words a texel), then the blocks, two a row. One texture keeps the consumers' binding:
 * the deferred resolve already holds the eight storage buffers WebGPU guarantees.
 *
 * Passes, all compute (`transmissionPass.ts`): clear (a redrawn slice is stamped, its counts
 * zero; a redrawn or freed slice gives its blocks back), then per chunk of blended rows the opaque
 * raster's cull (`renderCullWgsl.ts`), `pages` (each command's pages whose slice is redrawn) and
 * `bin` (each command's triangles projected once, then every (page, triangle) of it recorded or
 * skipped); then `number` (each slice with a record takes this frame's number and its place),
 * `place` (each record into its slice's run of the order) and `resolve` (a group per slice builds
 * its cells in the group's memory, takes its blocks from the pool and writes its cell lists and
 * records), and `headers` (the page headers of the slices that changed). No global atomic is
 * issued per cell: the cells are counted in a slice's own group.
 */
/** The share of an edge value's terms' magnitude the cover test allows for rounding, 2⁻²⁰. */
export const EDGE_SLACK = 2 ** -20
/** The texels a cell comes in grown by in the cover tests, 2⁻¹⁰. */
export const CELL_GROWTH = 2 ** -10
/** Texels a side of a cell. */
export const VSM_TRANSMISSION_CELL = 8
/** Cells a side of a page. */
export const VSM_TRANSMISSION_CELLS = VSM_PAGE_TEXELS / VSM_TRANSMISSION_CELL
export const CELL_COUNT = VSM_TRANSMISSION_CELLS ** 2
/** Blocks a slice chains at most: 65 536 words, a sun at 5° over two layers of 10-pixel triangles. */
export const VSM_TRANSMISSION_CHAIN = 32
/** The shifts that divide by a block, by the width, by the pages a header row holds (four words a
 *  texel, two a page): every size a power of two, so the read folds by mask and shift. */
export const BLOCK_SHIFT = floorLog2(VSM_TRANSMISSION_BLOCK_TEXELS)
export const WIDTH_SHIFT = floorLog2(VSM_TRANSMISSION_WIDTH)
export const HEADER_SHIFT = WIDTH_SHIFT + 1
/** A slice's first texels: the cell headers, then the chain. */
export const HEADER_TEXELS = CELL_COUNT / 4
export const RECORDS_TEXEL = HEADER_TEXELS + VSM_TRANSMISSION_CHAIN / 4
/** Bytes of a command's header in the chunk's page list (row, map | mip | flags, first page, page
 *  count) and of one of its pages (slice key, virtual page). */
export const VSM_TRANSMISSION_HEADER_BYTES = 16
export const VSM_TRANSMISSION_PAGE_BYTES = 8
/** A record's transmittance word: read from its patch (a textured caster), not its own value. */
export const TEXTURED_BIT = 1 << 24
/** A record's cells word (\`vsmTCellsWord\`): the triangle turns clockwise. */
export const CLOCKWISE_BIT = 1 << 16

const COUNTERS_WGSL = wgslBlock(
  'VSM_TRANSMISSION_COUNTERS_WGSL',
  [],
  Object.entries(VSM_TRANSMISSION_COUNTERS)
    .map(([name, at]) => `const VSM_TC_${name.toUpperCase()}:u32=${at}u;`)
    .join('\n'),
)

/** The frame uniform: the clear's stamp, the first blended row, the capacities, where the records
 *  and patches start, and the chunk lists' commands and pages (`VsmTransmissionFrame`). */
export const FRAME_STRUCT_WGSL = wgslBlock(
  'FRAME_STRUCT_WGSL',
  [],
  `
struct VsmTransmissionFrame{stamp:u32,rowFirst:u32,records:u32,patchWords:u32,blocks:u32,regionRecords:u32,regionPatches:u32,cmds:u32,pairs:u32,spare0:u32,spare1:u32,spare2:u32,}`,
)

/** Where block \`b\`'s texel \`t\` lies in the readable memory below its \`headerRows\` rows of page
 *  headers, two blocks a row: the resolve writes there, every shadow consumer reads there. */
export const VSM_T_BLOCK_AT_WGSL = wgslFn(
  'vsmTBlockAt',
  [],
  `fn vsmTBlockAt(b:u32,t:u32,headerRows:u32)->vec2u{return vec2u((b&1u)*${VSM_TRANSMISSION_BLOCK_TEXELS}u+t,headerRows+(b>>1u));}`,
)

/** The frame uniform, the build buffer's regions and the common constants. */
export const frameWgsl = (layout: VsmLayout) => {
  const P = layout.poolPages
  const r = vsmTransmissionRegions(P, { records: 0, patchWords: 0, blocks: 0 })
  return wgslBlock(
    `vsmTransmissionFrame(${P})`,
    [FRAME_STRUCT_WGSL, COUNTERS_WGSL, FLAT_INDEX_WGSL],
    `${wgslConsts({
      VSM_T_STAMPS: r.stamps,
      VSM_T_FIRST: r.first,
      VSM_T_COUNTS: r.counts,
      VSM_T_PATCH: r.patchCounts,
      VSM_T_KEYS: r.sliceKeys,
      VSM_T_DIRTY: r.dirty,
      VSM_T_ORDER: r.order,
      VSM_T_KEY_COUNT: 2 * P,
      VSM_T_CELLS: CELL_COUNT,
      VSM_T_CHAIN: VSM_TRANSMISSION_CHAIN,
      VSM_T_BLOCK_TEXELS: VSM_TRANSMISSION_BLOCK_TEXELS,
      VSM_T_RECORDS_TEXEL: RECORDS_TEXEL,
      VSM_T_RECORD_WORDS: VSM_TRANSMISSION_RECORD_WORDS,
      VSM_T_HEADER_ROWS: headerRows(P),
    })}`,
  )
}

/** One dispatch's arguments for `n` groups, in rows. */
export const ARGS_WGSL = wgslBlock(
  'ARGS_WGSL',
  [GROUP_GRID_WGSL],
  `
fn vsmTArgs(at:u32,n:u32){let g=groupGrid(n);args[at]=g.x;args[at+1u]=g.y;args[at+2u]=1u;}`,
)

/** Threads of a group of the page-wide kernels. */
export const VSM_TRANSMISSION_PAGE_GROUP = 256

/**
 * Threads of a group of the per-command kernels (`vsmTransmissionPages`, `vsmTransmissionBin`): one
 * group a command, its own width, not the dispatch's tunable one (`WORKGROUP_THREADS`) — the bin
 * holds a projected triangle a thread in the group's memory (\`tris\`, a \`VsmTTri\` each), which
 * must stay within the workgroup storage every device holds (\`GUARANTEED_WORKGROUP_BYTES\`), with the command's five words beside it
 * (`transmissionGroup.test.ts` lays the bin's workgroup memory out as WGSL does and holds it there).
 */
const VSM_TRANSMISSION_COMMAND_GROUP = 64
/** \`VSM_TRANSMISSION_COMMAND_GROUP\` as the per-command kernels name it. */
export const VSM_T_COMMAND_GROUP_WGSL = wgslConst(
  'VSM_T_COMMAND_GROUP',
  [],
  wgslConsts({ VSM_T_COMMAND_GROUP: VSM_TRANSMISSION_COMMAND_GROUP }),
)

/** The persistent tables, group \`group\` from binding \`first\`: page × slice → first block, the
 *  block pool [free count, spare, free blocks…], each block's next in its chain. */
export const transmissionTablesWgsl = (group: number, first: number) =>
  wgslBlock(
    `transmissionTables(${group}, ${first})`,
    [],
    `
@group(${group}) @binding(${first}) var<storage,read_write> table:array<u32>;
@group(${group}) @binding(${first + 1}) var<storage,read_write> pool:array<atomic<u32>>;
@group(${group}) @binding(${first + 2}) var<storage,read_write> links:array<u32>;`,
  )
