// The luminance of a linear colour on the host, for the tests that read rendered images.

/** The luminance of a linear sRGB colour, `0.2126·r + 0.7152·g + 0.0722·b` summed in that order. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
