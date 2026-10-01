import type { HostAttributes } from '../host/resources.ts';
import type { PageSurface } from '../page/surface.ts';
import type { Texture } from '../../../sdk-core/src/index.ts';
import { HOST_FORMAT_RGBA } from '../host/surfaceConstants.ts';
import { texelFormatOf } from '../host/textureImport.ts';
import {
  VIS_INVALID,
  VIS_TRIANGLE_BITS,
  VIS_TRIANGLE_MASK,
  VIS_MAX_PAGE_TRIANGLES,
} from './visWords.ts';
export { VIS_TRIANGLE_BITS, VIS_TRIANGLE_MASK } from './visWords.ts';
/** Largest addressable page count. Row `VIS_MAX_PAGES-1` still leaves 0xffffffff free as a sentinel. */
export const VIS_MAX_PAGES = 0xfffffe;
/** Rejects a page the identifier cannot address, naming the page so a bad cache is actionable. */
export function assertVisibilityPageTriangles(triangles: number, page?: string) {
  if (!Number.isInteger(triangles) || triangles < 0 || triangles > VIS_MAX_PAGE_TRIANGLES)
    throw new Error(
      `VISIBILITY_PAGE_TRIANGLES: ${triangles} triangles exceed the ${VIS_MAX_PAGE_TRIANGLES} a visibility identifier addresses${page ? ` (${page})` : ''}`,
    );
  return triangles;
}
export const PAGE_INFO_STRIDE = 272;
/** Deformation metadata follows the physical-material block; all offsets are u32 words. */
export const PAGE_DEFORM_WORD = 64,
  PAGE_DEFORM_COUNT_WORD = 65,
  PAGE_DEFORM_OUTPUT_WORD = 66;
export const FLAG_LIT = 1,
  FLAG_DOUBLE = 2,
  FLAG_HAS_UV = 4,
  FLAG_HAS_MAP = 8,
  FLAG_HAS_NORMAL = 16,
  /** The row's pool slot holds this cluster's quantized geometry page (`WGP3`), not its index
   *  page: every corner, position and attribute is decoded from those words in place
   *  (`../cluster/decodeWgsl.ts`). A primitive the compiler gave no geometry page keeps the source
   *  float buffers, and its rows carry this bit at zero. */
  FLAG_CLUSTER_PAGE = 32,
  /** A map of the material has a filter word (`../texture/sampling.ts`): its reads take the
   *  texture's filter rule. Without it, every read is the default one, and nothing else is run. */
  FLAG_SAMPLED = 64,
  FLAG_MASK = 128,
  FLAG_BACK = 256,
  FLAG_HAS_ORM = 512,
  FLAG_HAS_NORMAL_MAP = 1024,
  FLAG_HAS_TANGENT = 2048,
  /** The transparent draw reads its clusters from the compacted list, not an index buffer of its own. */
  FLAG_PAGED = 4096,
  /** Frame flag, not a material one: the whole frame comes out as raw albedo because no light is
   *  declared, or because the host asked for the unlit view. Only the transparent draw reads it —
   *  the opaque path has its own resolve program for that. */
  FLAG_UNLIT_VIEW = 8192,
  /** The material transmits: the surface reads the already-drawn background instead of blending by alpha. */
  FLAG_TRANSMISSIVE = 16384,
  /** The material reads its vertex colours and the geometry carries some: the base colour is
   *  multiplied by the interpolated vertex colour, as the forward path does. */
  FLAG_HAS_COLOR = 32768,
  /** A blended cluster's shadow-only row (`../webgpu/row/blendCasters.ts`): no depth, only the
   *  transmittance of its coverage (`PageInfo.blendCoverage`, `../gpu/shadow/transmittance.ts`). */
  FLAG_BLEND_CASTER = 65536,
  /** Frame flag of the transparent draw: a diagnostic view is shown, the surface's own lighting is
   *  not (`../webgpu/blend/uniforms.ts`, `diagnosticBits`). */
  FLAG_DIAGNOSTIC_VIEW = 0x40000000;
/** Fog opt-out above the model bits; a dynamic geometry's row, reactive to the temporal pass (#573). */
export const FLAG_FOG_FREE = 1 << 20,
  FLAG_DYNAMIC = 1 << 21;
export type VisPage = {
  array: Uint32Array;
  attributes: HostAttributes;
  /** The engine's surface record, read once at the boundary (`../page/surface.ts`). */
  material: PageSurface;
  clusterId?: string;
};
export type { VisMaterial } from './materialType.ts';

export type UnpackedVisibility = { pageIndex: number; triangleIndex: number };

/**
 * CPU mirror of the packing the shaders write inline (`page.packedBase|(triangle&0xffu)` in
 * `shader/visWgsl.ts` and `../gpu/raster/pixelWgsl.ts`, `id>>8u` / `id&0xffu` at unpack in
 * `shader/shadeWgsl.ts`). Two languages: the text is not shared, the layout is.
 */
export function packVisibilityId(pageIndex: number, triangleIndex: number) {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= VIS_MAX_PAGES ||
    !Number.isInteger(triangleIndex) ||
    triangleIndex < 0 ||
    triangleIndex > VIS_TRIANGLE_MASK
  )
    throw new Error('VISIBILITY_ID_RANGE');
  // The page field reaches past 2^31, so the shift is done in floating point and forced unsigned.
  return ((pageIndex + 1) * VIS_MAX_PAGE_TRIANGLES + (triangleIndex & VIS_TRIANGLE_MASK)) >>> 0;
}

export function unpackVisibilityId(id: number): UnpackedVisibility | null {
  if (id === VIS_INVALID) return null;
  return { pageIndex: (id >>> VIS_TRIANGLE_BITS) - 1, triangleIndex: id & VIS_TRIANGLE_MASK };
}

export { isTransmissive } from './shader/material.ts';

/** Why raw texels cannot be read as `textureRgba` reads them — one byte per channel of four, as
 *  many as the size holds —, or nothing when they can: a gate names the storage, never draws it
 *  blank. */
export const texelsReason = ({ format, image }: { format?: number; image: unknown }) => {
  if (format !== HOST_FORMAT_RGBA) return `texel format ${format} is unsupported: RGBA only`;
  const { data, width, height } = image as { data?: unknown; width: number; height: number };
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray))
    return 'texel storage is unsupported: 8-bit texels only';
  if (data.length !== width * height * 4)
    return `texel storage holds ${data.length} bytes, not ${width}×${height} RGBA`;
};

/** Why the texels a record holds in memory cannot be read as `textureRgba` reads them, in
 *  `texelsReason`'s words: its host's format for raw texels, RGBA for any other picture. The
 *  WebGPU fill throws it (#43), as the WebGL2 gate refuses the host by `texelsReason`. */
export const texelsRefusal = (texture: Texture) =>
  texelsReason({ format: texelFormatOf(texture) ?? HOST_FORMAT_RGBA, image: texture.image });

export type TextureRgba = { data: Uint8Array; width: number; height: number };
/**
 * Bytes of a texture, kept as long as it shows the same image. The rasterizer and the sample
 * call this per texel read: without a cache, each texel allocated a `Uint8Array` view and an
 * object. The source is rechecked every call — buffer, offset, length, width, height — so a
 * replaced image does yield the new bytes.
 */
const rgbaCache = new WeakMap<Texture, { source: ArrayBufferView; rgba: TextureRgba }>();

export function textureRgba(texture: Texture): TextureRgba | null {
  const image = texture.image as
    { data?: ArrayBufferView; width?: number; height?: number } | undefined;
  if (!image?.data || !image.width || !image.height) return null;
  const src = image.data;
  const held = rgbaCache.get(texture);
  if (
    held &&
    held.source === src &&
    held.rgba.width === image.width &&
    held.rgba.height === image.height &&
    held.rgba.data.buffer === src.buffer &&
    held.rgba.data.byteOffset === src.byteOffset &&
    held.rgba.data.byteLength === src.byteLength
  )
    return held.rgba;
  const rgba: TextureRgba = {
    data: new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    width: image.width,
    height: image.height,
  };
  rgbaCache.set(texture, { source: src, rgba });
  return rgba;
}
