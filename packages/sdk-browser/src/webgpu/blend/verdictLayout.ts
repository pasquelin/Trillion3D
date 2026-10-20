import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE VERDICT WORDS OF AN IMAGE, one storage buffer of the scene (`verdictWgsl.ts`): the counts the
 * frame reads back a few images late. Their word offsets, laid out from one field table
 * (`fieldLayout`).
 */
const VERDICT_RECORD = fieldLayout('Verdict', [
  // Drawn items that draw nothing this image: the cut left them without a cluster.
  ['rejected', 'u32'],
  // Drawn transmissive items whose box the frustum keeps: while none is, no distortion can be
  // drawn (`../pages/render/encodeBlend.ts`): without a refracting surface in view it would
  // only copy the scene onto itself.
  ['inView', 'u32'],
] as const)

/** The verdict's word offsets by field. */
export const VERDICT = VERDICT_RECORD.at
/** Words of the verdict, every one cleared before it is judged. */
export const VERDICT_WORDS = VERDICT_RECORD.words
/** Bytes the frame reads back: the rejected and in-view counts. */
export const VERDICT_READ_BYTES = 8

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
