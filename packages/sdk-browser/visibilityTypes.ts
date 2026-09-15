import * as THREE from 'three';

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
  FLAG_WRAP_S_REPEAT = 32,
  FLAG_WRAP_T_REPEAT = 64,
  FLAG_MASK = 128,
  FLAG_BACK = 256,
  FLAG_HAS_ORM = 512,
  FLAG_HAS_NORMAL_MAP = 1024,
  FLAG_HAS_TANGENT = 2048,
  /** Le dessin transparent lit ses clusters dans la liste compactée, pas un tampon d'indices à lui. */
  FLAG_PAGED = 4096,
  /**
   * Drapeau de l'image, pas du matériau : l'image entière sort en albédo brut parce qu'aucune lampe
   * n'est déclarée, ou parce que l'hôte a demandé la vue sans éclairage. Seul le dessin transparent
   * le lit — l'opaque a pour cela son propre programme de résolution.
   */
  FLAG_UNLIT_VIEW = 8192;
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
  transmission: number;
};

export type UnpackedVisibility = { pageIndex: number; triangleIndex: number };

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
  const lit = !!std.isMeshStandardMaterial;
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: lit ? std.metalness : 0,
    roughness: lit ? std.roughness : 1,
    lit,
    doubleSided: first.side === THREE.DoubleSide,
    backSide: first.side === THREE.BackSide,
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
  };
}

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the forward path. */
export function isTransmissive(material: THREE.Material | THREE.Material[]) {
  return visMaterial(material).transmission > 0;
}

type TextureRgba = { data: Uint8Array; width: number; height: number };
/**
 * Les octets d'une texture, gardés tant qu'elle montre la même image. Le rastériseur et l'échantillon
 * appellent ceci par texel lu : sans mémoire, chaque texel allouait une vue `Uint8Array` et un objet.
 * La source est revérifiée à chaque appel — tampon, décalage, longueur, largeur, hauteur — donc une
 * image remplacée rend bien les nouveaux octets.
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
