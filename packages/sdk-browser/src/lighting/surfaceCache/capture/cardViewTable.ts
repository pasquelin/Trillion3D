import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import type { CardView } from '../../../../../sdk-core/src/lighting/surfaceCache/cardViews.ts'

/**
 * THE VIEWS OF A CAPTURE, as the GPU reads them: one record for each page an image draws, in a table
 * the descent, the cull and the rasters of the cards share (`cardDescentWgsl.ts`, `cardRasterWgsl.ts`)
 * and the surfaces' shading reads again from the rows of the capture atlas's identifier texture past
 * the image (`../../../visibility/shader/pixelTriangleWgsl.ts`).
 *
 * A view is the page's orthographic view (`cardPageView`) taken to the render frame, whose origin is
 * the eye: the matrix `viewProj` takes a point of the render frame to the clip space of the page's
 * own picture, `rect` is where that picture lies in the capture atlas (`x, y, width, height`),
 * `lod.x` its pixels to a metre — what an error of the mesh is projected by — and `place.x` the rank
 * of the placement whose mesh it draws, in the cut's tables. The records are laid in the order of
 * their placements, so that the clusters of one placement find their views as a run.
 */
export const CARD_VIEW = fieldLayout('CardView', [
  ['viewProj', 'mat4x4f'],
  ['rect', 'vec4u'],
  ['lod', 'vec4f'],
  ['place', 'vec4u'],
] as const)

/** Words of a record. */
export const CARD_VIEW_WORDS = CARD_VIEW.words

/** Words of the table before its records: the rows the image holds (written by the GPU), the views it
 *  holds, two spare. */
export const CARD_TABLE_HEAD = 4
/** The table's words for `views` records. */
export const cardTableWords = (views: number) => CARD_TABLE_HEAD + CARD_VIEW_WORDS * views

/**
 * The WGSL that reads a view's matrix and rectangle, over `cardWord(v, k)` — word `k` of view `v`'s
 * record — which the program defines for the place it holds the table in (a storage buffer, or the rows
 * of the identifier texture). The three shaders that read views (`cardDescentWgsl.ts`,
 * `cardRasterWgsl.ts`, `pixelTriangleWgsl.ts`) share it.
 */
export const CARD_VIEW_READ_WGSL = wgslBlock(
  'CARD_VIEW_READ_WGSL',
  [],
  `fn cardVec4(v:u32,k:u32)->vec4f{return vec4f(bitcast<f32>(cardWord(v,k)),bitcast<f32>(cardWord(v,k+1u)),bitcast<f32>(cardWord(v,k+2u)),bitcast<f32>(cardWord(v,k+3u)));}
fn cardMatrix(v:u32)->mat4x4f{return mat4x4f(cardVec4(v,${CARD_VIEW.at.viewProj}u),cardVec4(v,${CARD_VIEW.at.viewProj + 4}u),cardVec4(v,${CARD_VIEW.at.viewProj + 8}u),cardVec4(v,${CARD_VIEW.at.viewProj + 12}u));}
fn cardRect(v:u32)->vec4u{return vec4u(cardWord(v,${CARD_VIEW.at.rect}u),cardWord(v,${CARD_VIEW.at.rect + 1}u),cardWord(v,${CARD_VIEW.at.rect + 2}u),cardWord(v,${CARD_VIEW.at.rect + 3}u));}
`,
)

/** A view to draw and the rank of the placement it draws. */
export interface CardViewSource {
  readonly view: CardView
  readonly place: number
}

/** The table's words, as integers and as floats. */
export interface CardTableImage {
  readonly u: Uint32Array
  readonly f: Float32Array
}

/**
 * Lays the views `sources` in `image`, in the order of their placements, for an image whose render frame
 * has its origin at `eye` (metres): the matrix of a view is its own, which takes a point from its anchor,
 * taken from the eye — `M · (p + eye − anchor)`, composed in double. Fills `order` with the source each
 * record is, and returns the views laid.
 */
export function writeCardViews(
  image: CardTableImage,
  sources: readonly CardViewSource[],
  eye: ArrayLike<number>,
  order: number[],
) {
  order.length = sources.length
  for (let k = 0; k < sources.length; k++) order[k] = k
  order.sort((a, b) => sources[a]!.place - sources[b]!.place || a - b)
  const { u, f } = image
  const at = CARD_VIEW.at
  u[0] = 0
  u[1] = sources.length
  order.forEach((index, rank) => {
    const { view, place } = sources[index]!
    const m = view.viewProjection
    const o = CARD_TABLE_HEAD + CARD_VIEW_WORDS * rank
    const d0 = eye[0]! - view.anchor[0],
      d1 = eye[1]! - view.anchor[1],
      d2 = eye[2]! - view.anchor[2]
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 4; r++) f[o + at.viewProj + c * 4 + r] = m[c * 4 + r]!
    for (let r = 0; r < 4; r++)
      f[o + at.viewProj + 12 + r] = m[12 + r]! + m[r]! * d0 + m[4 + r]! * d1 + m[8 + r]! * d2
    const { rect } = view
    const width = rect.maxX - rect.minX,
      height = rect.maxY - rect.minY
    u[o + at.rect] = rect.minX
    u[o + at.rect + 1] = rect.minY
    u[o + at.rect + 2] = width
    u[o + at.rect + 3] = height
    // The pixels a metre spans along the picture's axes: the rows of the matrix are the axes over the
    // half sides of the page, the picture is `width` and `height` pixels over [-1, 1].
    const px = 0.5 * width * Math.hypot(m[0]!, m[4]!, m[8]!),
      py = 0.5 * height * Math.hypot(m[1]!, m[5]!, m[9]!)
    f[o + at.lod] = Math.max(px, py)
    u[o + at.place] = place
  })
  return sources.length
}
