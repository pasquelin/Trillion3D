/**
 * THE OCCLUSION CULLING'S RESOURCES, made with a shadow set whose layout asks them
 * (`VsmLayout.occlusion`, the setting `shadowOcclusionCulling`): the depth pyramid of the physical
 * pool and the tables it is read through, each frame's own and the previous frame's.
 *
 * - The pyramid:
 *   r32float, one layer (two with `shadowDynamicHzb`: the static casters' and the dynamic casters'), `VSM_PYRAMID_MIPS` levels, level 0 half the pool's power-of-two extent
 *   (`vsmPyramidSize`): per page 64, 32, 16, 8, 4, 2 and 1 texels, each the farthest depth (reversed
 *   Z: the least) of the 2x2 texels under it. Written by the build (`occlusionWgsl.ts`), one storage
 *   view a level; read by the cull, every level, by load. Never cleared: a set's first frame has no
 *   previous one to read it through.
 * - The kept tables: the page table, the pages' marks
 *   (level 0, a word a page) and the stale rects of a frame — the blocks and rects its maps hold
 *   alone —, copied from its buffers once its pages are granted (`encodeKeptTables`) into its frame
 *   set's textures — `kept[0]` with `frames[0]`,
 *   `kept[1]` with `frames[1]` —: the next frame's first cull reads them as the previous frame's,
 *   this frame's second cull as its own. Textures and not buffers: the cull binds the eight storage
 *   buffers a stage holds already, and reads these by load as sampled textures, r32uint as the
 *   reference's page table and flags are.
 * - The build's page list, its two dispatches' arguments and their cleared copy, its parameters
 *   (`occlusionPass.ts`).
 */
import {
  VSM_KEPT_RECTS_WIDTH,
  VSM_LEVEL0_PAGES,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_PYRAMID_MIPS,
} from '../constants.ts'
import { VSM_TABLES_PER_ROW, type VsmLayout } from '../layout.ts'
import { keptRectRows, keptRectRowsOf, occlusionBufferSizes } from '../layoutBytes.ts'

/** A frame set's kept tables: its page table, its pages' marks and its stale rects. */
export interface VsmKeptTables {
  table: GPUTexture
  marks: GPUTexture
  rects: GPUTexture
}

/** The occlusion's resources of a set beside its tables (`VsmResources.occlusion`). */
export interface VsmOcclusionResources {
  pyramid: GPUTexture
  /** The physical pages the build rebuilds, a word each. */
  pages: GPUBuffer
  /** The build's two indirect dispatches: (16, pages, 1) for the levels a tile builds, then
   *  (pages, 1, 1) for the top levels. */
  args: GPUBuffer
  /** The arguments cleared, copied over `args` before each selection. */
  argsInit: GPUBuffer
  /** The build's parameters: whether every allocated page is rebuilt. */
  params: GPUBuffer
  /** Whether the previous frame set's kept tables hold the previous frame (`keepVsmFrame`). */
  prevKept: boolean
  /** Whether this frame copied its tables (`encodeKeptTables`). */
  copied: boolean
}

/** The cleared arguments of the build: no page in either dispatch. */
const PYRAMID_ARGS_INIT = new Uint32Array([16, 0, 1, 0, 0, 1, 1, 0])

/** The pyramid's texture. */
const pyramidDescriptor = (layout: VsmLayout): GPUTextureDescriptor => ({
  label: 'vsm.occlusionPyramid',
  size: [layout.pyramidSize[0], layout.pyramidSize[1], layout.hzbLayers],
  format: 'r32float',
  mipLevelCount: VSM_PYRAMID_MIPS,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** The kept tables' textures of frame set `k`. */
const keptDescriptors = (layout: VsmLayout, k: number) => {
  const usage =
    GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
  const [width, height] = layout.pageTableSize
  return {
    table: { label: `vsm.keptTable${k}`, size: [width, height], format: 'r32uint', usage },
    marks: { label: `vsm.keptMarks${k}`, size: [width, height], format: 'r32uint', usage },
    rects: {
      label: `vsm.keptRects${k}`,
      size: [VSM_KEPT_RECTS_WIDTH, keptRectRows(layout)],
      format: 'rgba32uint',
      usage,
    },
  } satisfies Record<keyof VsmKeptTables, GPUTextureDescriptor>
}

/** Both frame sets' kept tables of `layout`, made into `made`. */
export function createKeptTables(device: GPUDevice, layout: VsmLayout, made: GPUTexture[]) {
  const set = (k: number): VsmKeptTables => {
    const d = keptDescriptors(layout, k)
    const make = (descriptor: GPUTextureDescriptor) => {
      const texture = device.createTexture(descriptor)
      made.push(texture)
      return texture
    }
    return { table: make(d.table), marks: make(d.marks), rects: make(d.rects) }
  }
  return [set(0), set(1)] as [VsmKeptTables, VsmKeptTables]
}

/** The pyramid and the build's buffers of `layout`, the buffers made by `buffer`, the pyramid into
 *  `textures`. */
export function createOcclusion(
  device: GPUDevice,
  layout: VsmLayout,
  buffer: (label: string, size: number, usage?: GPUBufferUsageFlags) => GPUBuffer,
  textures: { push(texture: GPUTexture): unknown },
): VsmOcclusionResources {
  const sizes = occlusionBufferSizes(layout)
  const copy = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  const pyramid = device.createTexture(pyramidDescriptor(layout))
  textures.push(pyramid)
  const argsInit = buffer('pyramidArgsInit', sizes.pyramidArgsInit, copy)
  device.queue.writeBuffer(argsInit, 0, PYRAMID_ARGS_INIT)
  return {
    pyramid,
    pages: buffer('pyramidPages', sizes.pyramidPages),
    args: buffer(
      'pyramidArgs',
      sizes.pyramidArgs,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | copy,
    ),
    argsInit,
    params: buffer('pyramidParams', sizes.pyramidParams, GPUBufferUsage.UNIFORM | copy),
    prevKept: false,
    copied: false,
  }
}

/**
 * The frame's tables copied into its frame set's kept tables:
 * after its pages are granted, before its raster — no pass of the raster writes them. Only what its
 * maps hold: the page table and its marks over the `blocks` table blocks the frame's maps were packed
 * into (`tableBlocks.ts`: blocks of 128 × 192 entries, row by row from the origin — the whole block
 * rows, then the last row's first blocks), and the stale rects of its `mapCount` maps.
 */
export function encodeKeptTables(
  encoder: GPUCommandEncoder,
  frame: { pageTable: GPUBuffer; pageMarks: GPUBuffer; staleRects: GPUBuffer },
  kept: VsmKeptTables,
  layout: VsmLayout,
  { mapCount, blocks }: { mapCount: number; blocks: number },
) {
  const width = layout.pageTableSize[0]
  const fullRows = Math.floor(blocks / VSM_TABLES_PER_ROW),
    lastBlocks = blocks % VSM_TABLES_PER_ROW
  // A region of the table: `w` entries from the left of `h` rows from row `y`. The marks' level 0
  // opens their buffer (`markMipOffsets[0]`), laid as the table.
  const region = (y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return
    const source = { offset: y * width * 4, bytesPerRow: width * 4, rowsPerImage: h }
    for (const [buffer, texture] of [
      [frame.pageTable, kept.table],
      [frame.pageMarks, kept.marks],
    ] as const)
      encoder.copyBufferToTexture({ buffer, ...source }, { texture, origin: [0, y] }, [w, h])
  }
  region(0, width, fullRows * VSM_PAGE_TABLE_BLOCK_HEIGHT)
  region(
    fullRows * VSM_PAGE_TABLE_BLOCK_HEIGHT,
    lastBlocks * VSM_LEVEL0_PAGES,
    VSM_PAGE_TABLE_BLOCK_HEIGHT,
  )
  const rows = Math.min(keptRectRowsOf(mapCount), keptRectRows(layout))
  if (rows > 0)
    encoder.copyBufferToTexture(
      { buffer: frame.staleRects, bytesPerRow: VSM_KEPT_RECTS_WIDTH * 16, rowsPerImage: rows },
      { texture: kept.rects },
      [VSM_KEPT_RECTS_WIDTH, rows],
    )
}

/** The kept tables `from` carried into the grown `to` (`growVsmTables`): their rows, at the same
 *  texels — the page table's width is fixed. */
export function encodeKeptCarry(
  encoder: GPUCommandEncoder,
  from: VsmKeptTables,
  to: VsmKeptTables,
) {
  for (const name of ['table', 'marks', 'rects'] as const) {
    const source = from[name]
    encoder.copyTextureToTexture({ texture: source }, { texture: to[name] }, [
      source.width,
      source.height,
    ])
  }
}
