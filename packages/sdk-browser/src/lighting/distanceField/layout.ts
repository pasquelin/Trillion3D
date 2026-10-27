import { fieldLayout, type FieldType } from '../../gpu/core/fieldLayout.ts'
import {
  DISTANCE_FIELD_BRICK,
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_UNIQUE_BRICK,
} from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'

/**
 * HOW THE MESHES' DISTANCE FIELDS ARE LAID OUT FOR THE GPU, each number written once for the host
 * that fills the buffers and the programs that read them (`meshFieldWgsl.ts`).
 *
 * The scene holds, for each placement of a mesh that has a field, a record of bounds and a record of
 * data (`objectRecords.ts`), `vec4` strides of 3 and 10; for each mesh with a field, the data of
 * each of its mips loaded, the coarsest first (`assetRecords.ts`), 3 `vec4` a mip, 3 mips; the
 * indirection tables of the mips loaded in one buffer of words, each cell the brick's index in the
 * atlas or all ones for none; and the bricks in a 3D texture of bytes, 8 voxels of each brick's side.
 */

/** The `vec4`s of an object's bounds record: its centre (high part, then low part and bounding
 *  sphere radius), its box's half-extent and its flags. */
export const OBJECT_BOUNDS_STRIDE = 3
/** The `vec4`s of an object's data record. */
export const OBJECT_DATA_STRIDE = 10
/** The `vec4`s of one mip's asset record. */
export const ASSET_MIP_STRIDE = 3
/** The `vec4`s of a mesh's asset records: a record for each mip it can hold. */
export const ASSET_STRIDE = ASSET_MIP_STRIDE * DISTANCE_FIELD_MIPS
/** What an indirection cell holds where its brick is not stored. */
export const INVALID_BRICK_INDEX = 0xffffffff
/** The bits of an indirection side in an asset record, and the shift of the mips loaded. */
export const INDIRECTION_SIDE_BITS = 10
export const ASSET_MIPS_SHIFT = 30

/** The flags of an object's bounds record. `castShadow` is the object's own (`castShadow`);
 *  `virtualized` says it is made of clusters, which a sun's shadow maps draw (a sun's distance-field
 *  cascade leaves it out: `dfshCasts`). */
export const OBJECT_FLAGS = {
  oftenMoving: 1,
  castShadow: 2,
  virtualized: 4,
  emissive: 8,
  visible: 16,
  affectsIndirectLightingHidden: 32,
} as const

/** The bytes of a brick's voxels, and the voxels a brick adds to the texture along an axis. */
export const BRICK_VOXELS = DISTANCE_FIELD_BRICK ** 3
export const UNIQUE_BRICK = DISTANCE_FIELD_UNIQUE_BRICK
export const BRICK = DISTANCE_FIELD_BRICK

/** Three words of an unsigned vector, aligned on four. */
export const VEC3U: FieldType = { wgsl: 'vec3u', words: 3, align: 4 }

/** The block of the scene: what the programs need to find a brick, and how many objects there are. */
export const SCENE_BLOCK = fieldLayout('DfScene', [
  ['atlasMask', VEC3U],
  ['objects', 'u32'],
  ['atlasLog2', VEC3U],
  ['padA', 'u32'],
  ['texel', 'vec3f'],
  ['padB', 'f32'],
  ['halfTexel', 'vec3f'],
  ['padC', 'f32'],
  ['offsetToUv', 'vec3f'],
  ['padD', 'f32'],
  ['uniqueInTexels', 'vec3f'],
  ['padE', 'f32'],
] as const)
