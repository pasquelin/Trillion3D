/** The frozen backdrop costs a half-float colour (8 bytes) per pixel, and the depth the surface
 *  stage tests and writes 4 more; the other surfaces are the opaque resolve's, and the water word
 *  borrows the display colour (`../water/surfaceWgsl.ts`), already paid. */
export const WATER_BYTES_PER_PIXEL = 8 + 4;
