import type { Texture, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts';
import { textureRgba } from '../../visibility/types.ts';
import { grantedAnisotropy } from '../../../../sdk-core/src/texture/contract.ts';
import { followHostTexture } from '../../host/textureImport.ts';
import { pictureSize } from '../../texture/pictureSize.ts';

/**
 * A texture as uploaded, at its counters (#360, #361) and its size: a new version uploads the
 * picture again — in place at the same size and format (#362) —, a new `sampling` sets the sampler
 * alone. The placement is not uploaded here — the material binding uploads the UV matrix at every
 * draw (`materialBinding.ts`).
 */
type TextureRecord = {
  texture: WebGLTexture;
  version: number;
  sampling: number;
  width: number;
  height: number;
  format: number;
};
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

export class WebglClusterTextures {
  private records = new Map<string, TextureRecord>();
  private fallbacks = new Map<string, WebGLTexture>();
  private bound: Array<WebGLTexture | undefined> = [];
  private anisotropy: Anisotropy | null;
  /** The device's anisotropy ceiling, read once. */
  private maxAnisotropy = 1;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic') as Anisotropy | null;
    if (this.anisotropy)
      this.maxAnisotropy = gl.getParameter(
        this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
      ) as number;
  }
  bind(unit: number, texture?: Texture, color = false, fallback = [255, 255, 255, 255]) {
    const gl = this.gl;
    if (!texture) {
      const key = fallback.join(',');
      let target = this.fallbacks.get(key);
      if (!target) {
        target = gl.createTexture()!;
        this.fallbacks.set(key, target);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array(fallback),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else if (this.bound[unit] !== target) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, target);
      }
      this.bound[unit] = target;
      return;
    }
    // Brought up to its host at this bind, then uploaded or set again by its counters.
    followHostTexture(texture);
    const key = `${texture.id}:${color ? 'srgb' : 'linear'}`;
    let record = this.records.get(key);
    if (!record || record.version !== texture.version) {
      record = this.upload(unit, texture, color, record);
      this.records.set(key, record);
    } else {
      if (this.bound[unit] !== record.texture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, record.texture);
      }
      if (record.sampling !== texture.sampling) {
        record.sampling = texture.sampling;
        // `setSampler` writes the texture bound on the ACTIVE unit: select it even when the
        // texture is already bound there, or the parameters land on another unit's texture.
        gl.activeTexture(gl.TEXTURE0 + unit);
        this.setSampler(texture);
      }
    }
    this.bound[unit] = record.texture;
  }
  /**
   * Sends a texture's picture into its GL texture (#362): a picture of the size already held is
   * copied IN PLACE (`texSubImage2D`) — a video frame, a canvas redrawn —, one of a new size
   * reallocates the level; the GL texture itself is made once. Texels held in memory
   * (`texture.data`) upload through the byte overload, read as the WebGPU path reads them
   * (`textureRgba`); anything else is an image the browser decodes.
   */
  private upload(unit: number, texture: Texture, color: boolean, held?: TextureRecord) {
    const gl = this.gl;
    const target = held?.texture ?? gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
    const format = color ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      rgba = textureRgba(texture),
      image = texture.image as TexImageSource | undefined;
    if (!rgba && !image)
      throw new Error(`Cluster material texture ${texture.name || texture.id} has no image`);
    const [width, height] = rgba ? [rgba.width, rgba.height] : pictureSize(image);
    const inPlace = held?.width === width && held.height === height && held.format === format;
    if (inPlace && rgba)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba.data);
    else if (inPlace) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image!);
    else if (rgba)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        format,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba.data,
      );
    else gl.texImage2D(gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, image!);
    if (texture.generateMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    if (!held || held.sampling !== texture.sampling) this.setSampler(texture);
    return {
      texture: target,
      version: texture.version,
      sampling: texture.sampling,
      width,
      height,
      format,
    };
  }
  /** Addressing, filters and anisotropy of the texture bound on TEXTURE_2D. Anisotropy follows
   *  the rule the WebGPU path shares (`grantedAnisotropy`). */
  private setSampler(texture: Texture) {
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
  invalidateBindings() {
    this.bound.length = 0;
  }
  dispose() {
    for (const record of this.records.values()) this.gl.deleteTexture(record.texture);
    for (const texture of this.fallbacks.values()) this.gl.deleteTexture(texture);
    this.records.clear();
    this.fallbacks.clear();
  }
}
