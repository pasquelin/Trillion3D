import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  LAYER,
  MOTION,
  SHAPE,
  physicsBudgetError,
  physicsMatterOf,
  readCookedPhysics,
  type CommandWriter,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { createCookedSoftBodies } from './cookedSoft.ts';
import {
  cookedBytes,
  isModel,
  locate,
  moversOf,
  placedOf,
  tilePose,
  type Model,
  type Placed,
} from './tilePlace.ts';
import { boxPointDistance } from '../../../sdk-core/src/math/primitives/box.ts';

/** Tile fetches in flight at once. */
const FETCHES = 8;

/**
 * The cooked collision of the compiled models in a scene (`physics.json`), streamed into the
 * simulation within `budget.physics.triangles`: tiles load around the eye up to the active range
 * — the camera's draw distance, the scene's own — and around every moving body, nearest first,
 * and leave once no longer wanted. A tile is restored from Jolt's binary state, never rebuilt;
 * so are the soft bodies a model was cooked with (`cookedSoft.ts`), made as it opens.
 */
export function createTileStreamer(
  writer: CommandWriter,
  budget: PhysicsBudget,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** Each open model's tiles, empty until its file lands: the array is its opening, so one that
   *  left and came back while its file was on its way lands once, from the later opening. */
  const models = new Map<Model, Placed[]>();
  const byIndex = new Map<number, Placed>();
  const softs = createCookedSoftBodies(writer, bodies, invalidate, failed);
  let fetching = 0,
    overBudget = false;
  async function open(model: Model) {
    const placed: Placed[] = [];
    models.set(model, placed);
    const response = await fetch(new URL('physics.json', model.record.base).href);
    // A model compiled before the cook has no file: it collides nowhere, as before.
    if (!response.ok) return;
    const cooked = readCookedPhysics(await response.json());
    if (models.get(model) !== placed) return;
    placed.push(...placedOf(model, cooked));
    softs.open(model, cooked.softBodies);
    invalidate();
  }
  const evict = (p: Placed) => {
    if (p.id < 0) return;
    byIndex.delete(p.id & BODY_INDEX);
    bodies.release(p.id & BODY_INDEX);
    p.id = -1;
  };
  /** Everything `model` holds out: its tiles and its cooked soft bodies. */
  const drop = (model: Model, placed: Placed[]) => {
    placed.forEach(evict);
    softs.forget(model);
  };
  async function load(p: Placed) {
    const opening = models.get(p.model);
    p.loading = true;
    fetching++;
    try {
      const bytes = await cookedBytes(p.model, p.tile.url, 'Physics tile');
      // Its model left, or was opened again meanwhile: this tile is no longer one it holds.
      if (models.get(p.model) !== opening) return;
      p.id = bodies.claim(p.tile.triangles);
      const handle = p.id & BODY_INDEX;
      byIndex.set(handle, p);
      const { position, quaternion, scale } = tilePose(p);
      // The matter the node's collider declares, over the engine's default, as for every body.
      const matter = physicsMatterOf(p.instance);
      // Restored, built into one static body, and its handle dropped: the body keeps the shape.
      writer.restore(handle, bytes);
      writer.add({
        id: p.id,
        motion: MOTION.static,
        layer: LAYER.static,
        shape: SHAPE.cooked,
        flags: 0,
        position,
        quaternion,
        size: [scale.x, scale.y, scale.z],
        mass: 0,
        density: 0,
        friction: matter.friction,
        restitution: matter.restitution,
        gravityScale: 1,
        indices: [handle],
      });
      writer.release(handle);
      invalidate();
    } catch (error) {
      failed(error as EngineError);
    } finally {
      p.loading = false;
      fetching--;
    }
  }
  return {
    /** Finds the compiled models under `root`, opening the new ones and forgetting the gone. */
    scan(root: Object3D) {
      const seen = new Set<Model>();
      root.traverse((node) => {
        if (!isModel(node)) return;
        seen.add(node);
        if (!models.has(node)) open(node).catch((error) => failed(error as EngineError));
      });
      for (const [model, placed] of models)
        if (!seen.has(model)) {
          drop(model, placed);
          models.delete(model);
        }
    },
    /**
     * Brings the resident tiles in line with what is wanted: within `range` of `eye`, or within
     * reach of a moving body. Past the budget, the nearest are kept and the error is raised once,
     * naming the triangles asked.
     */
    update(eye: ArrayLike<number>, range: number) {
      if (!models.size) return;
      const wanted: [number, Placed][] = [],
        movers = moversOf(bodies.meshes);
      for (const placed of models.values())
        for (const p of placed) {
          let near = boxPointDistance(p.box, 0, eye[0], eye[1], eye[2]);
          if (near > range) near = Infinity;
          for (let m = 0; m < movers.length; m += 4)
            if (
              boxPointDistance(p.box, 0, movers[m], movers[m + 1], movers[m + 2]) <= movers[m + 3]
            )
              near = 0;
          if (near < Infinity) wanted.push([near, p]);
          else evict(p);
        }
      wanted.sort((a, b) => a[0] - b[0]);
      let room = budget.triangles - bodies.count.triangles,
        asked = bodies.count.triangles;
      for (const [, p] of wanted) {
        if (p.id >= 0 || p.loading) continue;
        asked += p.tile.triangles;
        if (p.tile.triangles > room) continue;
        room -= p.tile.triangles;
        if (fetching < FETCHES) void load(p);
      }
      if (asked > budget.triangles && !overBudget)
        failed(physicsBudgetError('triangles', budget.triangles, asked));
      overBudget = asked > budget.triangles;
    },
    /** The model a tile body's or a cooked soft body's engine id belongs to, or `null`. */
    modelOf: (id: number) => byIndex.get(id & BODY_INDEX)?.model ?? softs.modelOf(id),
    /** The worker refused body `id`: a tile or a cooked soft body leaves, its slot and budget
     *  given back, and is not made again until its model opens again; any other body is ignored. */
    refused(id: number) {
      const p = byIndex.get(id & BODY_INDEX);
      if (p?.id !== id) return softs.refused(id);
      evict(p);
      const placed = models.get(p.model)!;
      placed.splice(placed.indexOf(p), 1);
    },
    /** The glTF material of a tile body's triangles, `-1` for none or for another body. */
    materialOf: (id: number) => byIndex.get(id & BODY_INDEX)?.material ?? -1,
    /** A model moved: its resident tiles follow, its cooked soft bodies are made again. */
    moved(node: Object3D) {
      node.traverse((child) => {
        if (isModel(child)) softs.moved(child);
        for (const p of (isModel(child) && models.get(child)) || []) {
          locate(p);
          if (p.id < 0) continue;
          const { position, quaternion } = tilePose(p);
          writer.teleport(p.id & BODY_INDEX, position, quaternion);
        }
      });
    },
    /** Every tile and cooked soft body out (physics turned off). */
    clear() {
      models.forEach((placed, model) => drop(model, placed));
      models.clear();
    },
  };
}
