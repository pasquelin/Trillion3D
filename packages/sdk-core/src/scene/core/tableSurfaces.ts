/**
 * The surface half of the scene tables (`scene-tables.json`,
 * `packages/asset-compiler-rust/src/compiler/tables/materials.rs`): each material the prepared
 * scene wears, in the engine's own words, and the sampler state of each texture it samples.
 */
import type { DisplacementWire, ResponsiveLevel } from '../../contracts/materialAbi.ts'
import type { TextureFilter, WrapMode } from '../../texture/contract.ts'

/** The six map slots the engine reads of a surface, in the engine's own field names. */
export const TABLE_SLOTS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
] as const
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
] as const
/** The colour fields of a material in the tables, three numbers each. */
export const TABLE_TRIPLETS = ['baseColor', 'emissive', 'attenuationColor'] as const
/** The yes-or-no fields of a material in the tables. */
export const TABLE_FLAGS = ['lit', 'doubleSided', 'backSide', 'hasIor'] as const
type TableSlotName = (typeof TABLE_SLOTS)[number]

/** One filled map slot: which texture, which coordinate set, and the transform it declares. */
export interface TableTextureSlot {
  /** Which texture. */
  texture: number
  /** Which UV set it samples: its transform's when that one names a set, its own otherwise. */
  texCoord: number
  /** The UV set the slot names itself, before any transform: a slot naming another than the first
   *  is drawn from a copy of its texture, which answers to no rank. */
  slotTexCoord: number
  /** The `KHR_texture_transform` the slot declares — offset, turn in radians, stretch, each
   *  `null` when silent — or `null` for none. */
  transform: {
    offset: readonly [number, number] | null
    rotation: number | null
    scale: readonly [number, number] | null
  } | null
}
/** The filters as the compiler writes them (`tables/textures.rs`), each with the
 *  engine's `TextureFilter` it is: the one table between the two, read by the prepared loader at
 *  load. */
export const TABLE_FILTERS = {
  nearest: 'nearest',
  linear: 'linear',
  'nearest-mip-nearest': 'nearestMipNearest',
  'linear-mip-nearest': 'linearMipNearest',
  'nearest-mip-linear': 'nearestMipLinear',
  'linear-mip-linear': 'linearMipLinear',
} as const satisfies Record<string, TextureFilter>

/** A filter as the compiler writes it. */
export type TableFilter = keyof typeof TABLE_FILTERS

/** Sampler state of one glTF texture, in the compiler's words. */
export interface TableTexture {
  /** Its name. */
  name: string
  /** The rank of the glTF sampler it declares, `null` for none. */
  sampler: number | null
  /** Which image. */
  image: number | null
  /** Repeat across. */
  wrapS: WrapMode
  /** Repeat up. */
  wrapT: WrapMode
  /** Filter when bigger. */
  magFilter: TableFilter
  /** Filter when smaller. */
  minFilter: TableFilter
}
/** A material's displacement in the tables: the slot of its height map, read in its first channel
 *  as a data texture, and what the compiler resolved of the material's `extras` (`DISPLACEMENT_EXTRA`):
 *  the magnitude and the centre, the fade range in pixels or `null` for no fade. */
export type TableDisplacement = DisplacementWire & { map: TableTextureSlot }
/**
 * A surface as the engine reads it. One glTF material is one entry per tangent variant: a primitive
 * that declares no tangent is shaded in a frame rebuilt from its triangle, which flips
 * `normalScaleY`, so the table names a rank a node points at rather than the glTF material rank.
 * `derivativeTangents` says which variant the entry was written for, so a reader flips the sign
 * back when the geometry it holds disagrees.
 * @property lit - Whether lights shade it.
 * @property doubleSided - Whether both faces are drawn.
 * @property backSide - Whether only the back face is drawn.
 * @property hasIor - Whether it declares `KHR_materials_ior`: only then does it refract.
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
  name: string
  /** Whether it was written for tangents rebuilt on screen. */
  derivativeTangents: boolean
  /** Which surface the host builds: unlit, standard, or physical when a physical extension is
   *  declared. */
  kind: 'standard' | 'physical' | 'unlit'
  /** How alpha is read: ignored, cut at `alphaTest`, or blended. */
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND'
  /** The alpha of the base colour factor. */
  opacity: number
  /** What the physical extensions add, under the host's own parameter names: a factor, a colour
   *  or a range as numbers, a map as a slot. */
  extensions: Readonly<Record<string, number | readonly number[] | TableTextureSlot>>
  /** How far the temporal anti-aliasing trusts the history where it is worn — the compiler's one
   *  resolution of the job's `materials`, its `responsive` match and the material's `extras` —;
   *  written only above `off`, absent for the normal accumulation. */
  responsive?: ResponsiveLevel
  /** The displacement the material names and switches on, absent for every other material: the
   *  tessellation draws it displaced (`tessellation`, `TESSELLATION_RULES`). */
  displacement?: TableDisplacement
} & Record<(typeof TABLE_FLAGS)[number], boolean> &
  Record<(typeof TABLE_NUMBERS)[number], number> &
  Record<(typeof TABLE_TRIPLETS)[number], readonly [number, number, number]> &
  Record<TableSlotName, TableTextureSlot | null>
