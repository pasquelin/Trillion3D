import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { EXPAND_PASSES } from './planLayout.ts'
import { doubleReadWgsl } from '../../../../math/src/wgsl/doubleWords.ts'
import { doubleWords, fieldLayout, u32Words } from '../../gpu/core/fieldLayout.ts'

/**
 * THE HEAD OF THE FRAME DATA, the words an image sends the transparent kernels before the own
 * entries' seeds and slots (`order.ts`): the eye (four doubles), the frustum planes brought to the
 * eye in single precision and their forward-corner words (`framePlanes.ts`, what the verdict tests
 * with), what the water rectangle projects with (`../water/frameWords.ts`: the jittered projection
 * and its inverse in single precision, the view in doubles, the near plane, the target's size and
 * the view's form), the item count the verdict walks and the water items the rectangle walks.
 */
const HEAD = fieldLayout('FrameHead', [
  ['eye', doubleWords(4)],
  ['planes', u32Words(24)],
  ['sides', u32Words(6)],
  ['projection', u32Words(16)],
  ['inverse', u32Words(16)],
  ['view', doubleWords(16)],
  ['near', doubleWords(1)],
  ['width', 'u32'],
  ['height', 'u32'],
  ['viewForm', 'u32'],
  ['items', 'u32'],
  ['waters', 'u32'],
] as const)
/** Each field's first word, laid out by the one record rule (`fieldLayout`), doubles on even
 *  words; and the head's words. */
export const FRAME_HEAD = { ...HEAD.at, words: HEAD.words }
/** A plane's forward-corner word (`FRAME_HEAD.sides`): bits 0 to 2 its double normal's positive
 *  axes, this one set when the plane enters the single-precision test (`framePlanes.ts`). */
export const PLANE_USABLE = 8
/** The view's fourth row is `0, 0, 0, 1`: a corner's view depth is not divided. */
export const VIEW_AFFINE = 1

/** Words of the frame data a scene of `entries` entries a pass can send at most: the head, a seed
 *  and a slot per entry of each pass (`order.ts`). */
export const orderFrameWords = (entries: number) => FRAME_HEAD.words + 2 * EXPAND_PASSES * entries

/** The head's layout and its doubles' read, as each kernel that binds `frame` names them. */
export const FRAME_HEAD_WGSL = wgslBlock(
  'FRAME_HEAD_WGSL',
  [],
  `${wgslConsts({
    FRAME_EYE: FRAME_HEAD.eye,
    FRAME_PLANES: FRAME_HEAD.planes,
    FRAME_SIDES: FRAME_HEAD.sides,
    FRAME_PROJECTION: FRAME_HEAD.projection,
    FRAME_INVERSE: FRAME_HEAD.inverse,
    FRAME_VIEW: FRAME_HEAD.view,
    FRAME_NEAR: FRAME_HEAD.near,
    FRAME_WIDTH: FRAME_HEAD.width,
    FRAME_HEIGHT: FRAME_HEAD.height,
    FRAME_VIEW_FORM: FRAME_HEAD.viewForm,
    FRAME_ITEMS: FRAME_HEAD.items,
    FRAME_WATERS: FRAME_HEAD.waters,
    VIEW_AFFINE,
    PLANE_USABLE,
  })}
${doubleReadWgsl('frameDouble', 'frame')}`,
)
