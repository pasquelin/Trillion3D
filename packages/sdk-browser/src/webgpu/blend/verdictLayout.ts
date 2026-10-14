import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE VERDICT WORDS OF AN IMAGE, one storage buffer of the scene the transparent kernels share
 * (`verdictWgsl.ts`, `../water/rectWgsl.ts`): the counts the frame reads back a few images late,
 * the water rectangles' unions, what the water pass draws from them — the rectangle, the backdrop
 * copy and the indirect arguments that gate it —, and each water item's verdict. Their word
 * offsets, laid out from one field table (`fieldLayout`).
 */
const VERDICT_RECORD = fieldLayout('Verdict', [
  // Drawn items that draw nothing this image: an unpaged one the frustum rejects, a paged one the
  // cut left without a cluster.
  ['rejected', 'u32'],
  // Drawn transmissive items whose box the frustum keeps, paged ones included: while none is, no
  // water can draw (`../water/pass.ts`).
  ['inView', 'u32'],
  // The union of the kept water surfaces' rectangles, then of their backdrops' — each as
  // `~x0, ~y0, x1, y1`, so that one `atomicMax` folds every bound and zero words are empty.
  ['surface', 'vec4u'],
  ['backdrop', 'vec4u'],
  // Transmissive items that draw this image.
  ['drawn', 'u32'],
  // The rectangle the water pass covers, `x0, y0, x1, y1`, then the target's width and height.
  ['rect', 'array<vec4u,2>'],
  // The backdrop copy: its origin, then its size.
  ['copy', 'vec4u'],
  // `dispatchWorkgroupsIndirect` of the copy, over its 8×8 tiles.
  ['copyArgs', 'vec4u'],
  // `drawIndirect` of the rectangle's quad: the depth restore, then the composite.
  ['quadArgs', 'vec4u'],
  // One word per water rank, the last: the item draws this image.
  ['waterDraws', 'u32'],
] as const)
/** The verdict's word offsets by field. */
export const VERDICT = VERDICT_RECORD.at
/** Words the frame clears before the verdict: the counts and the unions, every word before the
 *  rectangle. */
export const VERDICT_CLEARED = VERDICT.rect
/** Bytes the frame reads back: the rejected and in-view counts. */
export const VERDICT_READ_BYTES = 8

/** Words of the verdict of a scene of `transmissive` water items. */
export const verdictWords = (transmissive: number) => VERDICT.waterDraws + transmissive

const constName = (name: string) =>
  `VERDICT_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`

/** The words' offsets as each kernel that binds the verdict names them (`VERDICT_REJECTED`…). */
export const VERDICT_WGSL = wgslBlock(
  'VERDICT_WGSL',
  [],
  wgslConsts(
    Object.fromEntries(Object.entries(VERDICT).map(([name, at]) => [constName(name), at])),
  ),
)
