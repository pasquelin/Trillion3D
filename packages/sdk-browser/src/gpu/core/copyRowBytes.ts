import { alignUp } from '../../../../math/src/scalar/integers.ts'

/** Bytes of a row of `width` four-byte texels in a buffer that a copy to or from a texture takes:
 *  padded to WebGPU's 256-byte row alignment. */
export const copyRowBytes = (width: number) => alignUp(width * 4, 256)
