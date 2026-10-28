import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'
import type { HizWorkSource } from './workDepthSource.ts'

export type GpuHiz = {
  width: number
  height: number
  level0: GPUTexture
  level0View: GPUTextureView
  /** The build of the drawn pyramid's culling layer from the depth drawn so far — the cut's main
   *  pass's, or the whole depth's —, as dispatches of the frame's compute pass. */
  encodePyramid(open: OpenPass): void
  /** The same build with the trace layers in its dispatches — the nearest layer, each pixel's plane
   *  and each cell's nearest, and the finished depth's farthest —, once level 0 holds the whole
   *  depth, as dispatches of the open compute pass. */
  encodeFull(open: OpenPass): void
  /** The image's own build — the culling layer's, with the trace layers where `full` — straight
   *  from the visibility buffer `source`: its first pass reads each pixel's depth there and writes
   *  level 0 with it, so no export of the buffer precedes it. */
  encodeFromWork(open: OpenPass, source: HizWorkSource, full: boolean): void
  /** The build of the drawn pyramid's culling layer with the push `push` of its level 0, for the
   *  primed pyramid (`hizPrime`): false when its kernel is not compiled yet. */
  encodePrimed(open: OpenPass, push: HizPrimedPush): boolean
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
  /** Whether the nearest layer is built as the planes' corners, with the finished depth's farthest
   *  layer and each pixel's slopes (`hizTrace` `'planes'`), or as the closest depth of each texel's
   *  centre, the pyramid the reference's trace walks: its words sent when they move, so that an
   *  image builds and a reader reads the mode it was told. */
  planes(wanted: boolean): void
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

/** The push of the primed pyramid's level 0: the projection's near and far planes and weight (1 a
 *  perspective, 0 an orthographic one), and the distance, in the scene's units, the depth moves
 *  away from the eye by. */
export type HizPrimedPush = { near: number; far: number; perspective: number; bias: number }

/** The resources of `GpuHiz.depth` (`createGpuHiz`). A new object whenever one of them changes: a
 *  reader's bind group follows its identity. */
export type HizDepth = {
  resources: [GPUTextureView, GPUTextureView, GPUBufferBinding]
}

/** One view's pyramid, at that view's size, held by the view while another is drawn. */
export type HizPyramid = { readonly width: number; readonly height: number; destroy(): void }
