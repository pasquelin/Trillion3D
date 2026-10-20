import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { DISTORTION_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'

/** The distortion's own bytes a pixel (`transmission.ts`): the copy of the opaque scene, an HDR
 *  colour, and the accumulated offsets. */
export const DISTORTION_BYTES_PER_PIXEL = texelBytesOf(HDR_FORMAT) + texelBytesOf(DISTORTION_FORMAT)
