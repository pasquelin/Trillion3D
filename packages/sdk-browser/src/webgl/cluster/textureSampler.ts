import type { Texture, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts';
import { grantedAnisotropy } from '../../../../sdk-core/src/texture/contract.ts';

type Anisotropy = { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number };

const wrap = (gl: WebGL2RenderingContext, value: WrapMode) =>
  value === 'repeat' ? gl.REPEAT : value === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;

const filter = (gl: WebGL2RenderingContext, value: TextureFilter) =>
  ({
    nearest: gl.NEAREST,
    linear: gl.LINEAR,
    'nearest-mip-nearest': gl.NEAREST_MIPMAP_NEAREST,
    'nearest-mip-linear': gl.NEAREST_MIPMAP_LINEAR,
    'linear-mip-nearest': gl.LINEAR_MIPMAP_NEAREST,
    'linear-mip-linear': gl.LINEAR_MIPMAP_LINEAR,
  })[value];

/** The sampling of the maps: addressing, filters, and anisotropy under the device's ceiling, read
 *  once. */
export class WebglTextureSampler {
  private gl: WebGL2RenderingContext;
  private anisotropy: Anisotropy | null;
  private maxAnisotropy = 1;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic') as Anisotropy | null;
    if (this.anisotropy)
      this.maxAnisotropy = gl.getParameter(
        this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
      ) as number;
  }
  /** Addressing, filters and anisotropy of the texture bound on TEXTURE_2D. Anisotropy follows
   *  the rule the WebGPU path shares (`grantedAnisotropy`). */
  set(texture: Texture) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(gl, texture.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(gl, texture.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter(gl, texture.magFilter));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter(gl, texture.minFilter));
    if (this.anisotropy)
      gl.texParameterf(
        gl.TEXTURE_2D,
        this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        grantedAnisotropy(texture, this.maxAnisotropy),
      );
  }
}
