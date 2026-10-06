/**
 * Surface stage of the water pass: the transmissive items draw with the blend vertex stage and
 * the blend material read (`blendSurface`), and store what they read instead of lighting it — the
 * surface buffer of the opaque resolve, free once that resolve consumed it, plus the hardware
 * depth of the surface. The fullscreen composite (`compositeWgsl.ts`) lights it once
 * per pixel, on the frozen backdrop, whatever the number of surfaces the pixel stacked.
 *
 * The fourth target carries the item's water rank — one-based so that zero means "no water
 * here", as the item record carries it above its flags — and the opacity in its high sixteen
 * bits: the composite reads the material volume at that rank and blends by that opacity. That
 * word never goes to the surface flags, which temporal antialiasing and the composition read
 * after the pass as the opaque resolve left them, nor to a target of its own: it borrows the
 * display colour (`DISPLAY_FORMAT`), which only the composition writes, after the pass, one byte
 * per channel — `unpack4x8unorm` stores each byte exactly, `pack4x8unorm` reads the same word back.
 */
export const WATER_RANK_SHIFT = 16
/** Transmissive items a scene may carry: the rank counts them in sixteen bits. */
export const WATER_MAX_ITEMS = (1 << WATER_RANK_SHIFT) - 1
