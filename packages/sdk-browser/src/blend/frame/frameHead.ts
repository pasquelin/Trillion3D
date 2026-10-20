import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { doubleReadFn } from '../../../../math/src/wgsl/doubleRead.ts'
import { doubleWords, fieldLayout, u32Words } from '../../gpu/core/fieldLayout.ts'

/**
 * THE HEAD OF THE FRAME DATA, the words an image sends the transparent kernels before the own
 * entries' seeds and slots (`../order/order.ts`): the eye (four doubles), the frustum planes brought to the
 * eye in single precision and their forward-corner words (`framePlanes.ts`, what the verdict tests
 * with), the item count the verdict walks, and where the cut's cold words hold the world's HLOD
 * cell states with the cells per instance (`../../geometry/dag/worlds/worldLinks.ts`): zero for a cut that
 * follows no world, whose items no cell hides.
 */
const HEAD = fieldLayout('FrameHead', [
  ['eye', doubleWords(4)],
  ['planes', u32Words(24)],
  ['sides', u32Words(6)],
  ['items', 'u32'],
  ['cellStates', 'u32'],
  ['cellCount', 'u32'],
] as const)
/** Each field's first word, laid out by the one record rule (`fieldLayout`), doubles on even
 *  words; and the head's words. */
export const FRAME_HEAD = { ...HEAD.at, words: HEAD.words }
/** A plane's forward-corner word (`FRAME_HEAD.sides`): bits 0 to 2 its double normal's positive
 *  axes, this one set when the plane enters the single-precision test (`framePlanes.ts`). */
export const PLANE_USABLE = 8

/** Words of the frame data a scene of `entries` plan entries can send at most: the head, a seed
 *  and a slot per entry (`../order/order.ts`). */
export const orderFrameWords = (entries: number) => FRAME_HEAD.words + 2 * entries

/** The head's layout and its doubles' read, as each kernel that binds `frame` names them. */
export const FRAME_HEAD_WGSL = wgslBlock(
  'FRAME_HEAD_WGSL',
  [],
  `${wgslConsts({
    FRAME_EYE: FRAME_HEAD.eye,
    FRAME_PLANES: FRAME_HEAD.planes,
    FRAME_SIDES: FRAME_HEAD.sides,
    FRAME_ITEMS: FRAME_HEAD.items,
    FRAME_CELL_STATES: FRAME_HEAD.cellStates,
    FRAME_CELL_COUNT: FRAME_HEAD.cellCount,
    PLANE_USABLE,
  })}
${doubleReadFn('frameDouble', 'frame')}`,
)
