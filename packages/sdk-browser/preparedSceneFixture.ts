/**
 * The records the two sides of the prepared-scene check are written against: the surface entry
 * the compiler writes for a glTF material that declares nothing
 * (`packages/asset-compiler-rust/src/compiler_tables/materials.rs`), the record the host builds of
 * that same material (`hostSurfaceImport.ts`), and a texture on either side.
 *
 * Kept beside the checks rather than in one of the test files: both tests read them, and a field
 * added to the contract is then added once.
 */
import type { TableMaterial, TableTexture, Texture } from '../sdk-core/src/index.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** What both sides of a default glTF material say alike: the flags, the factors and the colours
 *  the compiler writes and the host builds from the same specification defaults. The second
 *  normal factor is the flipped one — these records describe geometry without tangents, where the
 *  host rebuilds the tangent frame from screen derivatives. */
const surface = {
  lit: true,
  doubleSided: false,
  backSide: false,
  baseColor: [1, 1, 1],
  emissive: [0, 0, 0],
  attenuationColor: [1, 1, 1],
  metalness: 1,
  roughness: 1,
  alphaTest: 0,
  normalScale: 1,
  normalScaleY: -1,
  aoIntensity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
} satisfies Partial<TableMaterial> & Partial<VisMaterial>;

/** Table entry of that material: the shared fields, the empty map slots, and the variant the
 *  entry was written for (`derivativeTangents`). */
export const tableMaterial = (over: Partial<TableMaterial> = {}): TableMaterial => ({
  ...surface,
  name: '',
  derivativeTangents: true,
  map: null,
  metalnessMap: null,
  roughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
  ...over,
});

/** The same surface as the host holds it, the maps left empty until a case fills them. */
export const hostSurface = (over: Partial<VisMaterial> = {}): VisMaterial => ({
  ...surface,
  ...over,
});

/** Sampler state of one glTF texture, as the table carries it. */
export const tableTexture = (over: Partial<TableTexture> = {}): TableTexture => ({
  image: 0,
  wrapS: 'repeat',
  wrapT: 'repeat',
  magFilter: 'linear',
  minFilter: 'linear-mip-linear',
  ...over,
});

/** The texture object the loader hands the engine, with the same sampler state. */
export const hostTexture = (over: Partial<Texture> = {}): Texture => ({
  id: 'texture',
  name: '',
  version: 1,
  image: null,
  channel: 0,
  wrapS: 'repeat',
  wrapT: 'repeat',
  magFilter: 'linear',
  minFilter: 'linear-mip-linear',
  anisotropy: 1,
  flipY: false,
  premultiplyAlpha: false,
  generateMipmaps: true,
  colorSpace: 'srgb',
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  ...over,
});
