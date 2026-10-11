import type { PendingGrowth } from '../core/tableGrowth.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'

export type GpuHiz = {
  width: number
  height: number
  level0: GPUTexture
  level0View: GPUTextureView
  flags: GPUBuffer
  /** The build of the drawn pyramid's farthest layer from the depth drawn so far — the occluders'
   *  —, as dispatches of the frame's compute pass. */
  encodePyramid(open: OpenPass): void
  /** The build of its nearest layer — each pixel's plane, each cell's nearest — and of the
   *  finished depth's farthest layer, once level 0 holds the whole depth, as dispatches of the open compute pass. */
  encodeNearest(open: OpenPass): void
  /**
   * Adopts the tested boxes and the frame state the GPU partition writes. It is mounted after the
   * pyramid — it reads `flags` — so the bind group only knows them here. Without this call,
   * `encodeTest` encodes nothing: no row is then tested, so none is rejected.
   */
  attach(bounds: GPUBuffer, state: GPUBuffer): void
  /** Verdict flags for `rows` rows, made now and put in place by `commit`: the pyramids stay. */
  growFlags(rows: number): PendingGrowth
  /** Pyramid mips, offset and width: what the partition reads to express a screen
   *  rectangle in texels of the mip that covers it exactly. */
  levels(): Array<{ offset: number; width: number }>
  /** The pyramid texture's view, whose farthest layer the partition's cull and the transparent
   *  occlusion test walk with the `levels()` table. It changes identity on every target resize. */
  pyramidView(): GPUTextureView | undefined
  /** What a reader of the whole depth binds (`hizDepthEntries`, `hizDepthWgsl`): level 0, the
   *  pyramid and its levels uniform, in that order; `pyramid` names the drawn view's pyramid, which
   *  a reader's bind group follows. */
  depth(): HizDepth | undefined
  /**
   * Tests the boxes the partition compacted, as a dispatch of the frame's compute pass, after
   * the pyramid's build in the same pass; their count lives in the state, the CPU does
   * not read it, and the dispatch is sized by it (`testHizArgs`), not by the rows the table
   * holds. `maxRows`, the table's drawable rows, bounds what the uniform declares. Nothing is
   * cleared first: the partition wrote every drawable row's verdict this frame (`classifyRows`),
   * `0` for an occluder, and the test rewrites each tested row's. `pages` is the page table: a row
   * whose Hi-Z slot is none (never culled) is kept and counts no reject. Rejects are counted only
   * when `counting`, the frame whose counters are sampled (`GpuPartition.countsDue`).
   */
  encodeTest(
    device: GPUDevice,
    open: OpenPass,
    maxRows: number,
    pages: GPUBuffer,
    counting: boolean,
  ): number
  resize(device: GPUDevice, width: number, height: number): boolean
  /**
   * The `width × height` this image draws in the top-left of level 0, at most its size: the build,
   * the test and `levels()` read that, so a render-scale change remakes nothing. Level 0 is
   * cleared to the far plane beyond it, which never occludes.
   */
  extent(width: number, height: number): void
  /**
   * Installs `next` — a view's own pyramid, or none yet — and returns the one in place: the Hi-Z
   * half of a view switch, with no allocation and no device round trip. Without one, `width` and
   * `height` are 0 until `resize` makes the drawn view's own.
   */
  swap(next: HizPyramid | undefined): HizPyramid | undefined
  dispose(): void
}

/** The resources of `GpuHiz.depth`. */
export type HizDepth = {
  pyramid: GPUTexture
  resources: [GPUTextureView, GPUTextureView, GPUBufferBinding]
}

/** One view's pyramid, at that view's size, held by the view while another is drawn. */
export type HizPyramid = { readonly width: number; readonly height: number; destroy(): void }
