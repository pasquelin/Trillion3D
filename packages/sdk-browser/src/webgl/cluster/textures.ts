import type { Texture, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts';
import { textureRgba } from '../../visibility/types.ts';
import {
  grantedAnisotropy,
  pictureWords,
  textureChange,
} from '../../../../sdk-core/src/texture/contract.ts';

/**
 * A texture as uploaded: its version, the picture words it was uploaded from, its sampler state —
 * addressing, filters, anisotropy — and the anisotropy set on it. The UV placement is not sampler
 * state: the material binding uploads it at every draw (`materialBinding.ts`).
 */
type TextureRecord = {
  texture: WebGLTexture;
  version: number;
  picture: unknown[];
  sampler: string;
  anisotropy: number;
};
type Anisotropy = { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number };

const wrap = (gl: WebGL2RenderingContext, value: WrapMode) =>
  value === 'repeat' ? gl.REPEAT : value === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;

/** A texture's sampler state: the words a version can move without its pixels. */
const samplerOf = (texture: Texture) =>
  `${texture.wrapS}:${texture.wrapT}:${texture.magFilter}:${texture.minFilter}:${texture.anisotropy}`;

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
    const key = `${texture.id}:${color ? 'srgb' : 'linear'}`;
    let record = this.records.get(key);
    // What a moved version asks (`textureChange`): the sampler alone only when its words moved on
    // the same picture; pixels written in place, or any doubt, upload again (#360, #361). The
    // sampler words are only spelled out when the version moved.
    const sampler = record && record.version !== texture.version ? samplerOf(texture) : undefined;
    const change = record ? textureChange(record, texture, sampler !== record.sampler) : 'picture';
    if (record && change === 'sampler') {
      this.resample(unit, record, texture, sampler!);
      this.bound[unit] = record.texture;
      return;
    }
    if (!record || change === 'picture') {
      if (record) gl.deleteTexture(record.texture);
      const target = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
      // Texels held in memory (`texture.data`) upload through the byte overload, read as the
      // WebGPU path reads them (`textureRgba`); anything else is an image the browser decodes.
      const format = color ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        rgba = textureRgba(texture),
        image = texture.image as TexImageSource | undefined;
      if (rgba)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          format,
          rgba.width,
          rgba.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          rgba.data,
        );
      else if (image) gl.texImage2D(gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, image);
      else throw new Error(`Cluster material texture ${texture.name || texture.id} has no image`);
      if (texture.generateMipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      record = {
        texture: target,
        version: texture.version,
        picture: pictureWords(texture),
        sampler: sampler ?? samplerOf(texture),
        anisotropy: 1,
      };
      this.setSampler(record, texture);
      this.records.set(key, record);
    } else if (this.bound[unit] !== record.texture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, record.texture);
    }
    this.bound[unit] = record.texture;
  }
  /** Sets a sampler change on the texture already held, bound on `unit`: no new upload. */
  private resample(unit: number, record: TextureRecord, texture: Texture, sampler: string) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, record.texture);
    this.setSampler(record, texture);
    record.version = texture.version;
    record.sampler = sampler;
  }
  /** Addressing, filters and anisotropy of the texture bound on TEXTURE_2D. Anisotropy follows
   *  the rule the WebGPU path and the Three witness share (`grantedAnisotropy`). */
  private setSampler(record: TextureRecord, texture: Texture) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(gl, texture.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(gl, texture.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter(gl, texture.magFilter));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter(gl, texture.minFilter));
    if (!this.anisotropy) return;
    const anisotropy = grantedAnisotropy(texture, this.maxAnisotropy);
    if (anisotropy === record.anisotropy) return;
    gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, anisotropy);
    record.anisotropy = anisotropy;
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
