import type { CapturePage } from '../../../../../sdk-core/src/lighting/surfaceCache/captures.ts'
import type { CardView } from '../../../../../sdk-core/src/lighting/surfaceCache/cardViews.ts'

/**
 * THE SEAM BETWEEN THE SURFACE CACHE AND THE RASTER OF THE CARDS' VIEWS (`cardRaster.ts`). The surface
 * cache decides which pages of which cards are captured in an image (`updateSurfaceCache`) and where
 * each is drawn in the capture atlas; the raster draws them — the surface each page's view sees, as the
 * visibility the engine's raster writes — and the cache shades and copies what it drew (`shade.ts`,
 * `copy.ts`).
 *
 * The raster is given the capture atlas's two textures it writes (`CaptureTargets`): the identifier
 * of the nearest triangle of each texel (`ids`, `(row + 1) << 8 | triangle`, 0 where none: the
 * visibility buffer's own word, `../../../visibility/visWords.ts`) and its depth (`depth`, the engine's
 * reversed depth, 1 at the outer face of the page's card and 0 at its inner one), and the pages of the
 * image with the view each is drawn from (`CardView`: an orthographic view of the card whose picture
 * is the page, to be drawn into `rect` of the capture atlas). It returns the one image it drew; whether
 * each page of it was drawn whole comes back later (`CardBatch`).
 */

/** The capture atlas's textures the raster writes. */
interface CaptureTargets {
  /** Their side, in texels. */
  readonly side: number
  /** The views an image draws at most: the identifier texture holds a record for each past its image
   *  (`../../../visibility/shader/pixelTriangleWgsl.ts`). */
  readonly viewRows: number
  /** The identifier of the nearest triangle of each texel: `r32uint`, a storage texture. */
  readonly ids: GPUTextureView
  /** The depth of that triangle: `r32float`, a storage texture. */
  readonly depth: GPUTextureView
}

/**
 * What the raster drew: the visibility of the pages `pages` — indices into the pages of the
 * image's work, valid until the next draw — as the rows of `rows` name them. Every page of the image is in
 * it but those that could not be drawn. The surfaces' shading places a texel on its triangle by the view of the texel's row
 * (the identifier texture's records, past the image), so an image holds the pages of as many views as
 * the raster drew: all those the frame's budget captures.
 * `classKeys` are the material classes the rows may hold, each once.
 */
export interface CardImage {
  readonly pages: readonly number[]
  /** The page table the identifiers name, a buffer of the engine's rows (`PageInfo`), and how many. */
  readonly rows: GPUBuffer
  readonly rowCount: number
  readonly classKeys: readonly number[]
}

/**
 * What one image's draw left out, known a few images after it: the page-table index of each page it
 * drew (in the order of the views' records) and, for each, whether a budget cut its view short — the
 * rows' shared room, or the descent's pages and nodes —, so that the page is not whole. `stamp` is what
 * `draw` was given; `refresh` says every page of it is a periodic refresh (`CapturePage.refresh`).
 */
export interface CardBatch {
  readonly stamp: number
  readonly refresh: boolean
  readonly pages: number[]
  readonly lost: Uint8Array
}

/** A raster of the cards' views. */
export interface CardRaster {
  /** Whether the mesh of `placement` can be drawn now: the cut holds it, the raster is compiled. A
   *  placement that cannot waits; its pages are not made. */
  ready(placement: number): boolean
  /** What stopped the raster from compiling, none while it does or can. */
  readonly failure: unknown
  /**
   * Draws the pages `pages` — each with its view in `views`, at the same rank — into `targets` on
   * `encoder`, the render frame's origin at `eye` (metres), and returns the image drawn, which holds
   * the pages drawn; a page it could not draw is in none and is asked again. None where nothing was drawn.
   * The batch of the pages drawn is told by `landed` under `stamp`.
   */
  draw(
    encoder: GPUCommandEncoder,
    targets: CaptureTargets,
    pages: readonly CapturePage[],
    views: readonly CardView[],
    eye: ArrayLike<number>,
    stamp: number,
  ): CardImage | undefined
  /** The batches whose counters came back since the last call, valid until the next. Called once an
   *  image, after the image before was submitted. */
  landed(): readonly CardBatch[]
  /** Whether a batch that holds a page other than a refresh is still on its way back: the pages it
   *  drew are not known whole yet. A batch of refreshes alone is not waited for: the pages it
   *  rewrote read as they did, and one it lost is asked again when it lands. */
  readonly awaiting: boolean
  dispose(): void
}
