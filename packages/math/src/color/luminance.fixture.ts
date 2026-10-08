// The luminance of a linear colour on the host, for the tests that read rendered images: the
// shaders' `luminance` (`../wgsl/color.ts`) is the engine's.

/** The luminance of a linear sRGB colour, `0.2126·r + 0.7152·g + 0.0722·b` summed in that order:
 *  the weights and order of the shaders' `luminance` (`../wgsl/color.ts`). */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
