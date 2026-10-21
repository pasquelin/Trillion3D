import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'

export type GpuHiz = {
  width: number
  height: number
  level0: GPUTexture
  level0View: GPUTextureView
  /** The build of the drawn pyramid's farthest layer from the depth drawn so far — the cut's main
   *  pass's, or the whole depth's —, as dispatches of the frame's compute pass. */
  encodePyramid(open: OpenPass): void
  /** The build of its nearest layer — each pixel's plane, each cell's nearest — and of the
   *  finished depth's farthest layer, once level 0 holds the whole depth, as dispatches of the open compute pass. */
  encodeNearest(open: OpenPass): void
  /** The levels uniform (`hizLevelWords`): the one mip table, which the cut's occlusion test and
   *  the transparent occlusion test bind (`hizMip`) as the depth readers do. */
  readonly levelTable: GPUBuffer
  /** The pyramid texture's view, whose farthest layer the cut's occlusion test and the transparent
   *  occlusion test walk with the `levelTable`. It changes identity on every target resize. */
  pyramidView(): GPUTextureView | undefined
  /** What a reader of the whole depth binds (`hizDepthEntries`, `hizDepthWgsl`): level 0 — the
   *  opaque depth, and the front depth once asked (`front`) —, the pyramid and its levels uniform, in
   *  that order: a new object whenever one changes, which a reader's bind group follows. */
  depth(): HizDepth | undefined
  /** Level 0's front layer, which the transparents' front pass writes (`lighting/reflections/frontLayer.ts`):
   *  zero where no transparent surface lies; none unless `wanted` — an image whose transparents'
   *  fold writes it. Made with level 0: the readers fold it by a frame word only while an image
   *  writes it, so no reader folds a layer this image did not write. It changes identity on every
   *  target resize. */
  front(wanted: boolean): GPUTextureView | undefined
  resize(device: GPUDevice, width: number, height: number): boolean
  /**
   * The `width × height` this image draws in the top-left of level 0, at most its size: the build
   * and the levels uniform read that, so a render-scale change remakes nothing. Level 0 is
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

/** The resources of `GpuHiz.depth` (`createGpuHiz`). A new object whenever one of them changes: a
 *  reader's bind group follows its identity. */
export type HizDepth = {
  resources: [GPUTextureView, GPUTextureView, GPUBufferBinding]
}

/** One view's pyramid, at that view's size, held by the view while another is drawn. */
export type HizPyramid = { readonly width: number; readonly height: number; destroy(): void }
