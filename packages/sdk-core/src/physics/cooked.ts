import { EngineError } from '../contracts/cache.ts';

/**
 * `physics.json`, the physics a compiled model carries (stage `physics-cook` of the native
 * compiler, `packages/asset-compiler-rust/src/physics_cook/`). Its version is its own; the shapes it
 * names are Jolt binary state, readable only by the Jolt that wrote them: the file names that
 * commit, and a reader refuses another.
 */
const PHYSICS_FORMAT_VERSION = 1;
/** The Jolt commit the engine's physics module is built from: the pin of the submodule
 *  `packages/physics-jolt-wasm/JoltPhysics`, which the compiler's cook reads (`build.rs`). A test
 *  fails while the two differ (`physics.test.ts`). */
export const JOLT_COMMIT = 'e77f175595e64cb44218cc9d9d56fc365ad0e36a';

/** One cooked shape: a SHA-addressed object beside the manifest. */
export interface CookedTile {
  url: string;
  sha256: string;
  bytes: number;
  /** Triangles the shape holds: what it counts against `budget.physics.triangles`. */
  triangles: number;
  /** Its box in the primitive's frame: min x, y, z, max x, y, z. */
  bounds: [number, number, number, number, number, number];
}

/** The collision of one compiled primitive: a DAG cut in tiles, or one height field. */
interface CookedCollider {
  kind: 'mesh' | 'heightField';
  primitive: number;
  /** The glTF material of every triangle, or `null`. */
  material: number | null;
  /** The DAG error the level was cut at, and the distance measured to the drawn level 0. */
  tolerance: number;
  hausdorff: number;
  triangles: number;
  tiles: CookedTile[];
}

/** A collider placed by a node of the model: static ground, of the matter the node's collider
 *  declares (`KHR_physics_rigid_bodies` `physicsMaterial`), when it declares one. */
export interface CookedInstance {
  node: number;
  collider: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  friction?: number;
  restitution?: number;
}

/** The whole file. */
export interface CookedPhysics {
  formatVersion: number;
  jolt: string;
  stage: { name: string; version: number };
  colliders: CookedCollider[];
  instances: CookedInstance[];
  report: Record<string, number>;
}

/**
 * Reads a `physics.json` body: another format version, or shapes cooked by another Jolt, is
 * refused by name (`PHYSICS_FORMAT`), never read as something it is not.
 */
export function readCookedPhysics(file: unknown, jolt = JOLT_COMMIT): CookedPhysics {
  const cooked = file as Partial<CookedPhysics> | null;
  if (!cooked || cooked.formatVersion !== PHYSICS_FORMAT_VERSION)
    throw new EngineError(
      'PHYSICS_FORMAT',
      `physics.json format ${cooked?.formatVersion} is not ${PHYSICS_FORMAT_VERSION}: recompile the model.`,
      { formatVersion: cooked?.formatVersion ?? null },
    );
  if (cooked.jolt !== jolt)
    throw new EngineError(
      'PHYSICS_FORMAT',
      `physics.json was cooked with Jolt ${cooked.jolt}, the engine runs ${jolt}: recompile the model.`,
      { jolt: cooked.jolt ?? null },
    );
  if (!Array.isArray(cooked.colliders) || !Array.isArray(cooked.instances))
    throw new EngineError('PHYSICS_FORMAT', 'physics.json lists no colliders or instances.');
  return cooked as CookedPhysics;
}
