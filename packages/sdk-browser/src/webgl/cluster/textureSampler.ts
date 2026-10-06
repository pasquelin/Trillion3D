import type { Texture, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts'
import { grantedAnisotropy } from '../../../../sdk-core/src/texture/contract.ts'
export type Anisotropy = {
  TEXTURE_MAX_ANISOTROPY_EXT: number
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number
}

const wrap = (gl: WebGL2RenderingContext, value: WrapMode) =>
  value === 'repeat' ? gl.REPEAT : value === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE

const filter = (gl: WebGL2RenderingContext, value: TextureFilter) =>
  ({
    nearest: gl.NEAREST,
    linear: gl.LINEAR,
    'nearest-mip-nearest': gl.NEAREST_MIPMAP_NEAREST,
    'nearest-mip-linear': gl.NEAREST_MIPMAP_LINEAR,
    'linear-mip-nearest': gl.LINEAR_MIPMAP_NEAREST,
    'linear-mip-linear': gl.LINEAR_MIPMAP_LINEAR,
  })[value]

/** Existing texture sampler rule shared by uploads and sampler-only changes. */
export function setTextureSampler(
  gl: WebGL2RenderingContext,
  texture: Texture,
  anisotropy: Anisotropy | null,
  maxAnisotropy: number,
) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(gl, texture.wrapS))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(gl, texture.wrapT))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter(gl, texture.magFilter))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter(gl, texture.minFilter))
  if (anisotropy)
    gl.texParameterf(
      gl.TEXTURE_2D,
      anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
      grantedAnisotropy(texture, maxAnisotropy),
    )
}
