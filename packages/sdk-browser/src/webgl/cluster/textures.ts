import { setTextureSampler, type Anisotropy } from './textureSampler.ts';
import { WebglPhysicalMaps, PHYSICAL_MAP_UNIT } from './physicalMaps.ts';
import type { VisMaterial } from '../../visibility/types.ts';
import type { Matrix3UniformCache } from './uniforms.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import { textureRgba } from '../../visibility/types.ts';
import { mipFiltered } from '../../../../sdk-core/src/texture/contract.ts';
import { followHostTexture } from '../../host/textureImport.ts';
import { sourceSize } from '../../texture/pictureSize.ts';
import type { HostMaterials } from '../../host/resources.ts';
import { surfaceOf } from '../../page/surface.ts';
import { CoverageReaders } from '../../texture/coverage.ts';
import { WebglMipReducer, chainAllocated, type MipChain } from './mips.ts';
/** Uploaded native mip chain, with content and sampler versions tracked independently. */
type TextureRecord = MipChain & { sampling: number };
const WHITE: readonly number[] = [255, 255, 255, 255];
export class WebglClusterTextures {
  physicalMaps?: WebglPhysicalMaps;
  readonly uploads = { count: 0, bytes: 0, ms: 0 };
  private records = new Map<string, TextureRecord>();
  private fallbacks = new Map<string, WebGLTexture>();
  private bound: Array<WebGLTexture | undefined> = [];
  private anisotropy: Anisotropy | null;
  private maxAnisotropy = 1;
  private gl: WebGL2RenderingContext;
  private mips: WebglMipReducer;
  private readers = new CoverageReaders();
  private followed = new Map<Texture, number | null>();
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.mips = new WebglMipReducer(gl);
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic') as Anisotropy | null;
    if (this.anisotropy)
      this.maxAnisotropy = gl.getParameter(
        this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
      ) as number;
  }
  /** `reader`: a base or emissive map, its chain under its readers' rule (#42), as WebGPU's. */
  bind(unit: number, texture?: Texture, color = false, fallback = WHITE, reader = false) {
    const gl = this.gl;
    if (!texture) {
      const key = fallback.join(',');
      let target = this.fallbacks.get(key);
      if (!target) {
        target = gl.createTexture()!;
        this.fallbacks.set(key, target);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, target);
        const texel = new Uint8Array(fallback);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texel);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else if (this.bound[unit] !== target) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, target);
      }
      this.bound[unit] = target;
      return;
    }
    followHostTexture(texture);
    if (reader && !this.followed.has(texture)) {
      this.readers.follow([texture]);
      this.followed.set(texture, this.readers.cutoff(texture) ?? null);
    }
    const key = `${texture.id}:${color ? 'srgb' : 'linear'}${reader ? ':map' : ''}`,
      cutoff = reader ? this.followed.get(texture)! : null;
    let record = this.records.get(key);
    if (!record || record.version !== texture.version) {
      record = this.upload(unit, texture, color, cutoff, record);
      this.records.set(key, record);
    } else {
      if (this.bound[unit] !== record.texture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, record.texture);
      }
      const sampling = record.sampling !== texture.sampling,
        mips = record.cutoff !== cutoff && mipFiltered(texture.minFilter);
      // `setSampler` and the chain write the ACTIVE unit's texture: select it even if bound there.
      if (sampling || mips) gl.activeTexture(gl.TEXTURE0 + unit);
      if (sampling) {
        record.sampling = texture.sampling;
        setTextureSampler(gl, texture, this.anisotropy, this.maxAnisotropy);
      }
      if (mips) {
        const allocate = record.cutoff === undefined;
        record.cutoff = cutoff;
        this.mips.reduce(unit, record, allocate);
      }
    }
    this.bound[unit] = record.texture;
    return record;
  }
  private upload(
    unit: number,
    texture: Texture,
    color: boolean,
    cutoff: number | null,
    held?: TextureRecord,
  ) {
    const began = performance.now(),
      gl = this.gl;
    const target = held?.texture ?? gl.createTexture()!;
    try {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
      const format = color ? gl.SRGB8_ALPHA8 : gl.RGBA8,
        rgba = textureRgba(texture),
        image = texture.image as TexImageSource | undefined;
      if (!rgba && !image)
        throw new Error(`Cluster material texture ${texture.name || texture.id} has no image`);
      const [width, height] = sourceSize(texture);
      const inPlace = held?.width === width && held.height === height && held.format === format;
      if (inPlace && rgba)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          width,
          height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          rgba.data,
        );
      else if (inPlace) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image!);
      else if (rgba) {
        const { data } = rgba;
        gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      } else gl.texImage2D(gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, image!);
      const record: TextureRecord = {
        texture: target,
        version: texture.version,
        sampling: texture.sampling,
        width,
        height,
        format,
      };
      const allocate = !inPlace || held?.cutoff == null;
      if (mipFiltered(texture.minFilter)) {
        record.cutoff = cutoff;
        this.mips.reduce(unit, record, allocate);
      } else if (!inPlace) chainAllocated(gl, record);
      if (!held || held.sampling !== texture.sampling)
        setTextureSampler(this.gl, texture, this.anisotropy, this.maxAnisotropy);
      this.uploads.count++;
      this.uploads.bytes += width * height * 4;
      this.uploads.ms += performance.now() - began;
      return record;
    } catch (error) {
      if (!held) gl.deleteTexture(target);
      throw error;
    }
  }
  file(material: HostMaterials) {
    const surface = surfaceOf(material);
    if (!this.readers.read(surface)) return;
    for (const map of [surface.map, surface.emissiveMap, surface.subsurfaceMap])
      if (map) this.followed.delete(map);
  }
  beginFrame() {
    this.bound.length = 0;
    this.followed.clear();
    this.mips.trim();
  }
  physical(
    owner: object,
    material: VisMaterial,
    at: (name: string) => WebGLUniformLocation | null,
    matrices: Matrix3UniformCache,
  ) {
    this.physicalMaps ??= new WebglPhysicalMaps(this.gl);
    this.physicalMaps.bind(
      owner,
      material,
      (map) => this.bind(PHYSICAL_MAP_UNIT, map, false)!,
      at,
      matrices,
    );
  }
  release(texture: Texture) {
    this.physicalMaps?.cache.releaseTexture(texture);
    for (const [key, record] of this.records)
      if (key.startsWith(`${texture.id}:`)) {
        this.gl.deleteTexture(record.texture);
        this.records.delete(key);
      }
    this.followed.delete(texture);
    this.bound.length = 0;
  }
  dispose() {
    this.physicalMaps?.dispose();
    for (const record of this.records.values()) this.gl.deleteTexture(record.texture);
    for (const texture of this.fallbacks.values()) this.gl.deleteTexture(texture);
    this.records.clear();
    this.fallbacks.clear();
    this.mips.dispose();
  }
}
