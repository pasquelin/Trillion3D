/**
 * The node and material tables the compiler writes beside the pages (`scene-tables.json`,
 * `packages/asset-compiler-rust/src/compiler_tables.rs`): what the prepared scene is made of,
 * said by the cache instead of being read back out of the source file.
 *
 * A texture slot names a glTF rank, never a host object: the tables are read by a runtime that
 * has no rendering library, and the rank is what ties a slot to the previews the sidecar bakes.
 */
import { EngineError } from '../../contracts/cache.ts';
import type { TextureFilter, WrapMode } from '../../texture/contract.ts';

/** The name of the file that holds the node and material tables. */
export const SCENE_TABLES_FILE = 'scene-tables.json';
/** Version of the product as a whole; each table it carries is versioned in turn. */
export const SCENE_TABLES_VERSION = 1;
/** The version of the node table this runtime reads. */
export const NODE_TABLE_VERSION = 1;
/** The version of the material table this runtime reads. */
export const MATERIAL_TABLE_VERSION = 1;

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

/** One filled map slot: which texture, which coordinate set, and the 3×3 composed for it. */
export interface TableTextureSlot {
  /** Which texture. */
  texture: number;
  /** Which UV set. */
  texCoord: number;
  /** The UV transform, 3×3. */
  transform: readonly number[];
}
/** Sampler state of one glTF texture, in the engine's words. */
export interface TableTexture {
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
} & Record<(typeof TABLE_FLAGS)[number], boolean> &
  Record<(typeof TABLE_NUMBERS)[number], number> &
  Record<(typeof TABLE_TRIPLETS)[number], readonly [number, number, number]> &
  Record<TableSlotName, TableTextureSlot | null>;
/**
 * One drawn primitive: the node that carries it, its world pose, the surface it wears and its
 * rank among the copies of that same primitive — which is what instancing is here, one geometry
 * named by several nodes. `bounds` is the world box of the source geometry; the autonomous scene
 * publishes degenerate triangles in its place, so it is the cache's answer, not the loader's.
 */
export interface TableNode {
  /** The node's name. */
  name: string;
  /** The node's number. */
  node: number;
  /** Its parent's number. */
  parent: number | null;
  /** Its mesh's number. */
  mesh: number;
  /** Its primitive's number. */
  primitive: number;
  /** Its material's rank. */
  material: number;
  /** Which copy it is. */
  instance: number;
  /** Its world matrix. */
  matrix: readonly number[];
  /** Its world box. */
  bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] } | null;
}
/** The node and material tables a compiled model carries. */
export interface PreparedSceneTables {
  /** Product version. */
  version: number;
  /** Node table version. */
  nodeTableVersion: number;
  /** Material table version. */
  materialTableVersion: number;
  /** The nodes. */
  nodes: TableNode[];
  /** The materials. */
  materials: TableMaterial[];
  /** The textures. */
  textures: TableTexture[];
}

/**
 * The tables, or a named refusal. An unknown version is never guessed at: a product written by
 * another compiler, or before a table changed shape, says nothing this reader can check a scene
 * against, and reading it half way would turn a format change into a wrong comparison.
 */
export function assertSceneTables(value: unknown): PreparedSceneTables {
  const tables = value as PreparedSceneTables | null;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables))
    throw new EngineError('INVALID_SCENE_TABLES', 'scene tables are not a JSON object', {});
  for (const [field, expected] of [
    ['version', SCENE_TABLES_VERSION],
    ['nodeTableVersion', NODE_TABLE_VERSION],
    ['materialTableVersion', MATERIAL_TABLE_VERSION],
  ] as const)
    if (tables[field] !== expected)
      throw new EngineError(
        'UNSUPPORTED_SCENE_TABLES',
        `scene tables ${field} ${String(tables[field])} is not the ${expected} this runtime reads`,
        { [field]: tables[field] ?? null },
      );
  if (!Array.isArray(tables.nodes) || !Array.isArray(tables.materials))
    throw new EngineError('INVALID_SCENE_TABLES', 'scene tables carry no node or material table', {
      nodes: Array.isArray(tables.nodes) ? tables.nodes.length : null,
    });
  return { ...tables, textures: Array.isArray(tables.textures) ? tables.textures : [] };
}
