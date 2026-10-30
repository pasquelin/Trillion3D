/**
 * THE CUSTOM DEPTH OF AN OBJECT, written once and read by every carrier of it: whether the object is drawn into the custom depth
 * (`renderCustomDepth`, false), the value its pixels write into the custom stencil (`customDepthStencilValue`, 0 to 255, 0) and how
 * they write it (`customDepthStencilWriteMask`). The mask is `'default'` (the whole value), `255`, or one bit, `1`, `2`, `4`, `8`, `16`, `32`, `64`
 * or `128`: the pixel takes the value under the mask. The image holds one surface a pixel, so the stencil of a pixel is the value under the mask of
 * the surface in front there: the bits of a mask are not merged over a surface behind, nor written where the object is hidden by a surface that
 * does not ask. The mask-by-bit merge ignoring the depth is not done (the same limit as the reference's visibility-buffer emission).
 *
 * The engine's form is one word an object: the value in its low byte, the mask above it (zero for `'default'`, the bits otherwise),
 * and the object's request above both (`customDepthWord`).
 */

/** The masks a write may take, `'default'` first. */
const CUSTOM_DEPTH_STENCIL_WRITE_MASKS = ['default', 255, 1, 2, 4, 8, 16, 32, 64, 128] as const
/** A mask an object may set. */
export type CustomDepthStencilWriteMask = (typeof CUSTOM_DEPTH_STENCIL_WRITE_MASKS)[number]

/** The most the stencil value takes. */
const CUSTOM_DEPTH_STENCIL_MAX = 255
/** Where the mask sits in the word, and the request's bit above it. */
export const CUSTOM_DEPTH_MASK_SHIFT = 8
const CUSTOM_DEPTH_RENDER_BIT = 1 << 16
/** The words' fields, as masks. */
export const CUSTOM_DEPTH_VALUE_MASK = 0xff

/** Whether `value` is a stencil value: a whole number from 0 to 255. */
export const isCustomDepthStencilValue = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= CUSTOM_DEPTH_STENCIL_MAX

/** Whether `value` is a mask a write may take. */
export const isCustomDepthStencilWriteMask = (
  value: unknown,
): value is CustomDepthStencilWriteMask =>
  CUSTOM_DEPTH_STENCIL_WRITE_MASKS.some((one) => one === value)

/** The word of an object that asks for the custom depth with `value` and `mask`; 0 for one that does not. */
export const customDepthWord = (
  render: boolean,
  value: number,
  mask: CustomDepthStencilWriteMask,
) =>
  render
    ? CUSTOM_DEPTH_RENDER_BIT |
      ((mask === 'default' ? 0 : mask) << CUSTOM_DEPTH_MASK_SHIFT) |
      (value & CUSTOM_DEPTH_VALUE_MASK)
    : 0
