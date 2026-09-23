/**
 * The surface half of the scene tables (`scene-tables.json`,
 * `packages/asset-compiler-rust/src/compiler_tables/materials.rs`): each material the prepared
 * scene wears, in the engine's own words, and the sampler state of each texture it samples.
 */
import type { TextureFilter, WrapMode } from '../../texture/contract.ts';

/** The six map slots the engine reads of a surface, in the engine's own field names. */
export const TABLE_SLOTS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
] as const;
/** The number fields of a material in the tables. */
export const TABLE_NUMBERS = [
  'metalness',
  'roughness',
  'alphaTest',
  'normalScale',
  'normalScaleY',
  'aoIntensity',
  'transmission',
  'ior',
  'thickness',
  'attenuationDistance',
] as const;
/** The colour fields of a material in the tables, three numbers each. */
export const TABLE_TRIPLETS = ['baseColor', 'emissive', 'attenuationColor'] as const;
/** The yes-or-no fields of a material in the tables. */
export const TABLE_FLAGS = ['lit', 'doubleSided', 'backSide'] as const;
type TableSlotName = (typeof TABLE_SLOTS)[number];

/** One filled map slot: which texture, which coordinate set, and the transform it declares. */
export interface TableTextureSlot {
  /** Which texture. */
  texture: number;
  /** Which UV set. */
  texCoord: number;
  /** The `KHR_texture_transform` the slot declares — offset, turn in radians, stretch, each
   *  `null` when silent — or `null` for none. */
  transform: {
    offset: readonly [number, number] | null;
    rotation: number | null;
    scale: readonly [number, number] | null;
  } | null;
}
/** Sampler state of one glTF texture, in the engine's words. */
export interface TableTexture {
  /** Its name. */
  name: string;
  /** The rank of the glTF sampler it declares, `null` for none. */
  sampler: number | null;
  /** Which image. */
  image: number | null;
  /** Repeat across. */
  wrapS: WrapMode;
  /** Repeat up. */
  wrapT: WrapMode;
  /** Filter when bigger. */
  magFilter: TextureFilter;
  /** Filter when smaller. */
  minFilter: TextureFilter;
}
/**
 * A surface as the engine reads it. One glTF material is one entry per tangent variant: a host
 * that has to rebuild the tangent frame from screen derivatives flips `normalScaleY`, so the
 * table names a rank a node points at rather than the glTF material rank. `derivativeTangents`
 * says which variant the entry was written for — the autonomous scene publishes its primitives
 * without tangents, so a reader flips the sign back when the geometry it holds disagrees.
 * @property lit - Whether lights shade it.
 * @property doubleSided - Whether both faces are drawn.
 * @property backSide - Whether only the back face is drawn.
 * @property metalness - How metallic, 0 to 1.
 * @property roughness - How rough, 0 to 1.
 * @property alphaTest - Alpha below which pixels drop.
 * @property normalScale - Strength of the normal map.
 * @property normalScaleY - Strength of the normal map's second axis.
 * @property aoIntensity - Strength of the ambient-occlusion map.
 * @property transmission - How much light passes through.
 * @property ior - How much light bends going in.
 * @property thickness - How thick a see-through surface is.
 * @property attenuationDistance - How far light goes inside before it tints.
 * @property baseColor - The base colour, linear RGB.
 * @property emissive - The colour it gives off.
 * @property attenuationColor - The tint light takes inside.
 * @property map - The colour picture.
 * @property metalnessMap - The metalness picture.
 * @property roughnessMap - The roughness picture.
 * @property normalMap - The normal picture.
 * @property aoMap - The ambient-occlusion picture.
 * @property emissiveMap - The glow picture.
 */
export type TableMaterial = {
  /** The material's name. */
  name: string;
  /** Whether it was written for tangents rebuilt on screen. */
  derivativeTangents: boolean;
  /** Which surface the host builds: unlit, standard, or physical when a physical extension is
   *  declared. */
  kind: 'standard' | 'physical' | 'unlit';
  /** How alpha is read: ignored, cut at `alphaTest`, or blended. */
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  /** The alpha of the base colour factor. */
  opacity: number;
  /** What the physical extensions add, under the host's own parameter names: a factor, a colour
   *  or a range as numbers, a map as a slot. */
  extensions: Readonly<Record<string, number | readonly number[] | TableTextureSlot>>;
} & Record<(typeof TABLE_FLAGS)[number], boolean> &
  Record<(typeof TABLE_NUMBERS)[number], number> &
  Record<(typeof TABLE_TRIPLETS)[number], readonly [number, number, number]> &
  Record<TableSlotName, TableTextureSlot | null>;
