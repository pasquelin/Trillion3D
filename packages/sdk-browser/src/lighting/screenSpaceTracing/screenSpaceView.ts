import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SCREEN_SPACE_VIEW_AT } from './screenSpaceViewAt.ts'
import { LAYOUT } from './screenSpaceViewAt.ts'

/** Bytes of the view uniform. */
export const SCREEN_SPACE_VIEW_BYTES = LAYOUT.words * 4
/** Words of the view. */
export const SCREEN_SPACE_VIEW_WORDS = LAYOUT.words
export const SCREEN_SPACE_VIEW_WGSL = wgslBlock('SCREEN_SPACE_VIEW_WGSL', [], LAYOUT.wgsl)

/** The group every pass of this folder takes its resources in, and the binding of the view in it. */
export const SCREEN_SPACE_GROUP = 0
export const SCREEN_SPACE_VIEW_BINDING = 0

/** What a view writes of itself: the arrays are the fields' words. */
export interface ScreenSpaceViewFields {
  worldToClip: ArrayLike<number>
  clipToWorld: ArrayLike<number>
  worldToView: ArrayLike<number>
  viewToWorld: ArrayLike<number>
  clipToPrevClip: ArrayLike<number>
  prevClipToWorld: ArrayLike<number>
  depth: readonly [number, number, number, number]
  size: readonly [number, number]
  perspective: boolean
  origin: readonly [number, number, number]
  forward: readonly [number, number, number]
  pixelRadius: readonly [number, number]
  projectionScale: readonly [number, number]
  previous: readonly [number, number, number, number]
  reduced: readonly [number, number, number, number]
  reducedLimit: readonly [number, number, number, number]
  frame: readonly [number, number, number, number]
  reflection: readonly [number, number, number, number]
  tiles: readonly [number, number, number, number]
  minSpecular: number
  preExposure: number
  sky: readonly [number, number]
  temporal: readonly [number, number, number, number]
  blur: readonly [number, number, number]
}

/** Writes `fields` into `words` (a view's `SCREEN_SPACE_VIEW_WORDS` words; the `frame` lane is written through the unsigned view). */
export function writeScreenSpaceView(
  words: Float32Array,
  unsigned: Uint32Array,
  fields: ScreenSpaceViewFields,
) {
  const at = SCREEN_SPACE_VIEW_AT
  const put = (field: keyof typeof at, values: ArrayLike<number>) => {
    for (let i = 0; i < values.length; i++) words[at[field] + i] = values[i]
  }
  put('worldToClip', fields.worldToClip)
  put('clipToWorld', fields.clipToWorld)
  put('worldToView', fields.worldToView)
  put('viewToWorld', fields.viewToWorld)
  put('clipToPrevClip', fields.clipToPrevClip)
  put('prevClipToWorld', fields.prevClipToWorld)
  put('depth', fields.depth)
  put('size', [fields.size[0], fields.size[1], 1 / fields.size[0], 1 / fields.size[1]])
  put('camera', [...fields.origin, fields.perspective ? 1 : 0])
  put('forward', [...fields.forward, 0])
  put('pixelRadius', [...fields.pixelRadius, ...fields.projectionScale])
  put('previous', fields.previous)
  put('reduced', fields.reduced)
  put('reducedLimit', fields.reducedLimit)
  for (let i = 0; i < 4; i++) unsigned[at.frame + i] = fields.frame[i]
  put('reflection', fields.reflection)
  put('tiles', fields.tiles)
  put('tileSpecular', [fields.minSpecular, 0, 0, fields.preExposure])
  put('sky', [fields.sky[0], fields.sky[1], 0, 0])
  put('temporal', fields.temporal)
  put('blur', [...fields.blur, 0])
}
