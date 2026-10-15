import { alignUp } from '../../../../math/src/scalar/integers.ts'

/** Bytes of a row of `width` texels of `texelBytes` in a buffer that a copy to or from a texture
 *  takes: padded to WebGPU's 256-byte row alignment. */
export const copyRowBytes = (width: number, texelBytes: number) => alignUp(width * texelBytes, 256)
