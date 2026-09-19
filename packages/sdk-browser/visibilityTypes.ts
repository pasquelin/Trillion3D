import * as THREE from 'three';
import { sideOf } from './materialSide.ts';

export const VIS_INVALID = 0;
/**
 * Visibility identifier layout: `(pageRow + 1) << 8 | triangleIndex`, zero meaning background.
 *
 * A page is one cluster, and a cluster holds at most 128 triangles in a DAG cache and 256 in an older
 * cache, so eight bits index a triangle and the twenty-four remaining bits address the page. That is
 * 16.7 M pages instead of the 65 535 a 16/16 split allowed, which a scene replicated a few times
 * exhausts immediately.
 */
export const VIS_TRIANGLE_BITS = 8;
export const VIS_TRIANGLE_MASK = (1 << VIS_TRIANGLE_BITS) - 1;
/** Largest triangle count a page may carry; one more would collide with the next page's rows. */
export const VIS_MAX_PAGE_TRIANGLES = VIS_TRIANGLE_MASK + 1;
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
export const PAGE_INFO_STRIDE = 256;
export const FLAG_LIT = 1,
  FLAG_DOUBLE = 2,
  FLAG_HAS_UV = 4,
  FLAG_HAS_MAP = 8,
  FLAG_HAS_NORMAL = 16,
  FLAG_MASK = 128,
  FLAG_BACK = 256,
  FLAG_HAS_ORM = 512,
  FLAG_HAS_NORMAL_MAP = 1024,
  FLAG_HAS_TANGENT = 2048,
  /** The transparent draw reads its clusters from the compacted list, not an index buffer of its own. */
  FLAG_PAGED = 4096,
  /**
   * Frame flag, not a material one: the whole frame comes out as raw albedo because no light is
   * declared, or because the host asked for the unlit view. Only the transparent draw reads it —
   * the opaque path has its own resolve program for that.
   */
  FLAG_UNLIT_VIEW = 8192,
  /** The material transmits: the surface reads the already-drawn background instead of blending by alpha. */
  FLAG_TRANSMISSIVE = 16384;
// Bits 32, 64, 32768 and 65536 are free: they carried wrap of a single map, which
// `visibilityWrapModes.ts` now stores per map, in a word of its own.
export type VisPage = {
  array: Uint32Array;
  attributes: THREE.BufferGeometry['attributes'];
  matrix: THREE.Matrix4;
  material: THREE.Material | THREE.Material[];
  clusterId?: string;
};

export type VisMaterial = {
  baseColor: [number, number, number];
  metalness: number;
  roughness: number;
  lit: boolean;
  doubleSided: boolean;
  backSide: boolean;
  alphaTest: number;
  map?: THREE.Texture;
  metalnessMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  normalMap?: THREE.Texture;
  normalScale: number;
  normalScaleY: number;
  aoMap?: THREE.Texture;
  aoIntensity: number;
  emissive: [number, number, number];
  emissiveMap?: THREE.Texture;
  /** `KHR_materials_transmission.transmissionFactor`: the share of the background the surface lets through. */
  transmission: number;
  /** `KHR_materials_ior.ior`, and the volume of `KHR_materials_volume`. `attenuationDistance` is 0
   *  when the glTF does not declare one: the volume then attenuates nothing. */
  ior: number;
  thickness: number;
  attenuationDistance: number;
  attenuationColor: [number, number, number];
};

export type UnpackedVisibility = { pageIndex: number; triangleIndex: number };

/**
 * CPU mirror of the packing the shaders write inline (`page.packedBase|(triangle&0xffu)` in
 * `visibilityShaderId.ts` and `gpuRasterPixelWgsl.ts`, `id>>8u` / `id&0xffu` at unpack in
 * `visibilityShaderShade.ts`). Two languages: the text is not shared, the layout is.
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

export function visMaterial(material: THREE.Material | THREE.Material[]): VisMaterial {
  const first = Array.isArray(material) ? material[0] : material;
  const color =
    'color' in first && first.color instanceof THREE.Color ? first.color : new THREE.Color(1, 1, 1);
  const std = first as THREE.MeshStandardMaterial;
  const phys = first as THREE.MeshPhysicalMaterial;
  const lit = !!std.isMeshStandardMaterial,
    side = sideOf(first);
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: lit ? std.metalness : 0,
    roughness: lit ? std.roughness : 1,
    lit,
    doubleSided: side === 'double',
    backSide: side === 'back',
    alphaTest: 'alphaTest' in first && typeof first.alphaTest === 'number' ? first.alphaTest : 0,
    map: 'map' in first && first.map ? (first.map as THREE.Texture) : undefined,
    metalnessMap: lit && std.metalnessMap ? std.metalnessMap : undefined,
    roughnessMap: lit && std.roughnessMap ? std.roughnessMap : undefined,
    normalMap: lit && std.normalMap ? std.normalMap : undefined,
    normalScale: lit && std.normalScale ? std.normalScale.x : 1,
    normalScaleY: lit && std.normalScale ? std.normalScale.y : 1,
    aoMap: lit && std.aoMap ? std.aoMap : undefined,
    aoIntensity: lit ? std.aoMapIntensity : 1,
    emissive: lit
      ? [
          std.emissive.r * std.emissiveIntensity,
          std.emissive.g * std.emissiveIntensity,
          std.emissive.b * std.emissiveIntensity,
        ]
      : [0, 0, 0],
    emissiveMap: lit && std.emissiveMap ? std.emissiveMap : undefined,
    transmission:
      phys.isMeshPhysicalMaterial && typeof phys.transmission === 'number' ? phys.transmission : 0,
    ior: phys.isMeshPhysicalMaterial && typeof phys.ior === 'number' ? phys.ior : 1.5,
    thickness:
      phys.isMeshPhysicalMaterial && typeof phys.thickness === 'number' ? phys.thickness : 0,
    // Three yields `Infinity` when the glTF does not declare a distance; zero says “no attenuation”
    // without shipping an infinity as far as a uniform.
    attenuationDistance:
      phys.isMeshPhysicalMaterial && Number.isFinite(phys.attenuationDistance)
        ? phys.attenuationDistance
        : 0,
    attenuationColor:
      phys.isMeshPhysicalMaterial && phys.attenuationColor
        ? [phys.attenuationColor.r, phys.attenuationColor.g, phys.attenuationColor.b]
        : [1, 1, 1],
  };
}

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the forward path. */
export function isTransmissive(material: THREE.Material | THREE.Material[]) {
  return visMaterial(material).transmission > 0;
}

export type TextureRgba = { data: Uint8Array; width: number; height: number };
/**
 * Bytes of a texture, kept as long as it shows the same image. The rasterizer and the sample
 * call this per texel read: without a cache, each texel allocated a `Uint8Array` view and an
 * object. The source is rechecked every call — buffer, offset, length, width, height — so a
 * replaced image does yield the new bytes.
 */
const rgbaCache = new WeakMap<THREE.Texture, { source: ArrayBufferView; rgba: TextureRgba }>();

export function textureRgba(texture: THREE.Texture): TextureRgba | null {
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
