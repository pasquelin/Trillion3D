import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { EXPAND_PASSES } from './planLayout.ts'

/**
 * THE HEAD OF THE FRAME DATA, the words an image sends the transparent kernels before the own
 * entries' keys and seeds (`order.ts`): the eye (four doubles), the frustum planes (24 doubles, as
 * `frustumExcludesBox` reads them), what the water rectangle projects with (`../water/frameWords.ts`:
 * the jittered projection and its inverse in single precision, the view in doubles, the near plane,
 * the target's size and the view's form), the item count the verdict walks and the water items
 * the rectangle walks.
 */
export const FRAME_HEAD = {
  eye: 0,
  planes: 8,
  projection: 56,
  inverse: 72,
  view: 88,
  near: 120,
  width: 122,
  height: 123,
  viewForm: 124,
  items: 125,
  waters: 126,
  words: 128,
} as const
/** The view's fourth row is `0, 0, 0, 1`: a corner's view depth is not divided. */
export const VIEW_AFFINE = 1
/** The projection's fourth row is minus the view's third: a corner's clip `w` is minus its depth. */
export const VIEW_MIRRORED = 2

/** Words of the frame data a scene of `items` items, `entries` entries a pass, can send at most:
 *  the head, a key per item, a seed and a slot per entry of each pass (`order.ts`). */
export const orderFrameWords = (items: number, entries: number) =>
  FRAME_HEAD.words + 2 * items + 2 * EXPAND_PASSES * entries

/** The head's layout and its doubles' read, as each kernel that binds `frame` names them. */
export const FRAME_HEAD_WGSL = wgslBlock(
  'FRAME_HEAD_WGSL',
  [],
  `${wgslConsts({
    FRAME_PLANES: FRAME_HEAD.planes,
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
    VIEW_MIRRORED,
  })}
fn frameDouble(at:u32)->vec2u{return vec2u(frame[at+1u],frame[at]);}`,
)
