import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'

/** The water pass's own bytes a pixel: the frozen backdrop, an HDR colour, and the depth the
 *  surface stage tests and writes; the other surfaces are the opaque resolve's, and the water word
 *  borrows the display colour (`../water/surfaceWgsl.ts`), already paid. */
export const WATER_BYTES_PER_PIXEL = texelBytesOf(HDR_FORMAT) + texelBytesOf(DEPTH_FORMAT)
