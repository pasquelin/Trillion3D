/**
 * The tables the compiler writes beside the pages (`scene-tables.json`,
 * `packages/asset-compiler-rust/src/compiler_tables.rs`): the node graph, the lights, the
 * surfaces and the geometry layout of the prepared scene — everything the runtime builds that
 * scene from, said by the cache instead of being read back out of the source file.
 *
 * A texture slot names a glTF rank, never a host object: the tables are read by a runtime that
 * has no rendering library, and the rank is what ties a slot to the previews the sidecar bakes.
 */
import { EngineError } from '../../contracts/cache.ts';
import type { TableDocument } from './tableDocuments.ts';
import type { TableMaterial, TableTexture } from './tableSurfaces.ts';

/** The name of the file that holds the scene tables. */
export const SCENE_TABLES_FILE = 'scene-tables.json';
/** Version of the product as a whole; each table it carries is versioned in turn. */
const SCENE_TABLES_VERSION = 2;
/** The version of the node table this runtime reads: every node, with its local pose. */
const NODE_TABLE_VERSION = 2;
/** The version of the material table this runtime reads. */
const MATERIAL_TABLE_VERSION = 4;
/** The version of the geometry layout this runtime reads. */
const GEOMETRY_TABLE_VERSION = 1;

/**
 * One node of the scene graph, at its glTF rank: its children, the mesh, the punctual light and
 * the camera it carries, and its LOCAL pose exactly as declared — a matrix, or any of translation, rotation
 * and scale, each `null` when silent. Several nodes naming one mesh is what instancing is here.
 */
export interface TableNode {
  /** The node's name. */
  name: string;
  /** Its children, in order. */
  children: readonly number[];
  /** The mesh it draws. */
  mesh: number | null;
  /** The light it hangs. */
  light: number | null;
  /** The camera it carries. */
  camera: number | null;
  /** Morph weights that override its mesh's; `null` when silent. */
  weights: readonly number[] | null;
  /** Its local matrix, column-major. */
  matrix: readonly number[] | null;
  /** Where it stands. */
  translation: readonly number[] | null;
  /** How it is turned, as a quaternion. */
  rotation: readonly number[] | null;
  /** How it is stretched. */
  scale: readonly number[] | null;
}
/** A punctual light as `KHR_lights_punctual` declares it, each silent field `null`. */
export interface TableLight {
  /** Its name. */
  name: string;
  /** Its kind. */
  type: 'directional' | 'point' | 'spot';
  /** Its colour, linear. */
  color: readonly [number, number, number] | null;
  /** Its intensity, photometric. */
  intensity: number | null;
  /** Its reach. */
  range: number | null;
  /** Inner cone of a spot. */
  innerConeAngle: number | null;
  /** Outer cone of a spot. */
  outerConeAngle: number | null;
}
/** A camera as the glTF file declares it, each silent field `null`. */
export interface TableCamera {
  /** Its name. */
  name: string;
  /** Its projection. */
  type: 'perspective' | 'orthographic';
  /** Vertical field of view of a perspective camera, in radians. */
  yfov: number | null;
  /** Width over height of a perspective camera. */
  aspectRatio: number | null;
  /** Half width of an orthographic camera. */
  xmag: number | null;
  /** Half height of an orthographic camera. */
  ymag: number | null;
  /** Nearest distance drawn. */
  znear: number | null;
  /** Farthest distance drawn. */
  zfar: number | null;
}
/** The tables a compiled model carries. */
export interface PreparedSceneTables {
  /** Product version. */
  version: number;
  /** Node table version. */
  nodeTableVersion: number;
  /** Material table version. */
  materialTableVersion: number;
  /** Geometry layout version. */
  geometryTableVersion: number;
  /** The scene the host opens, and the nodes at its top. */
  scene: { name: string; nodes: readonly number[] };
  /** Every node. */
  nodes: TableNode[];
  /** The lights the nodes hang. */
  lights: TableLight[];
  /** The cameras the nodes carry. */
  cameras: TableCamera[];
  /** The surfaces. */
  materials: TableMaterial[];
  /** The textures. */
  textures: TableTexture[];
  /** The geometry layout of each published scene file, by its name. */
  documents: Readonly<Record<string, TableDocument>>;
}

/**
 * The tables, or a named refusal. An unknown version is never guessed at: a product written by
 * another compiler, or before a table changed shape, cannot be built into a scene, and reading it
 * half way would turn a format change into a wrong image.
 */
export function assertSceneTables(value: unknown): PreparedSceneTables {
  const tables = value as PreparedSceneTables | null;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables))
    throw new EngineError('INVALID_SCENE_TABLES', 'scene tables are not a JSON object', {});
  for (const [field, expected] of [
    ['version', SCENE_TABLES_VERSION],
    ['nodeTableVersion', NODE_TABLE_VERSION],
    ['materialTableVersion', MATERIAL_TABLE_VERSION],
    ['geometryTableVersion', GEOMETRY_TABLE_VERSION],
  ] as const)
    if (tables[field] !== expected)
      throw new EngineError(
        'UNSUPPORTED_SCENE_TABLES',
        `scene tables ${field} ${String(tables[field])} is not the ${expected} this runtime reads: ` +
          `the cache was written by another compiler — recompile it with this one ` +
          `(pnpm run build:native, then trillion3d-compiler <source> <cache> …)`,
        { [field]: tables[field] ?? null },
      );
  const missing = (['nodes', 'lights', 'cameras', 'materials', 'textures'] as const).filter(
    (field) => !Array.isArray(tables[field]),
  );
  if (missing.length || !tables.scene || !tables.documents || typeof tables.documents !== 'object')
    throw new EngineError('INVALID_SCENE_TABLES', 'scene tables miss a table', {
      missing: [
        ...missing,
        ...(tables.scene ? [] : ['scene']),
        ...(tables.documents ? [] : ['documents']),
      ],
    });
  return tables;
}
