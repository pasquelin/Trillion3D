import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  LAYER,
  MOTION,
  SHAPE,
  physicsBudgetError,
  physicsMatterOf,
  type CommandWriter,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { createModelBodies } from './cookedBodies.ts';
import {
  cookedBytes,
  cookedPhysics,
  isModel,
  locate,
  moversOf,
  placedOf,
  tilePose,
  type Model,
  type Placed,
} from './tilePlace.ts';
import { boxPointDistance } from '../../../sdk-core/src/math/primitives/box.ts';
import { ONE_REQUEST, retriableError } from '../cluster/pages.ts';

/** Tile fetches in flight at once. */
const FETCHES = 8;

/**
 * The cooked collision of the compiled models in a scene (`physics.json`), streamed into the
 * simulation within `budget.physics.triangles`: tiles load around the eye up to the active range
 * — the camera's draw distance, the scene's own — and around every moving body, nearest first,
 * and leave once no longer wanted. A tile is restored from Jolt's binary state, never rebuilt;
 * so are the bodies its nodes declare (`cookedBodies.ts`), made as it opens.
 */
export function createTileStreamer(
  writer: CommandWriter,
  budget: PhysicsBudget,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** Each open model's opening: its tiles, empty until its file lands, and the abort its leaving
   *  lets go of its reads by — one back while its file was on its way lands once, the later. */
  type Opening = { placed: Placed[]; abort: AbortController };
  const models = new Map<Model, Opening>();
  const declared = createModelBodies(writer, bodies, invalidate, failed);
  let fetching = 0,
    overBudget = false;
  function open(model: Model) {
    const opening: Opening = { placed: [], abort: new AbortController() };
    const { signal } = opening.abort;
    models.set(model, opening);
    cookedPhysics(model, signal)
      .then((cooked) => {
        // A model compiled before the cook collides nowhere, as before.
        if (!cooked || signal.aborted) return;
        opening.placed.push(...placedOf(model, cooked));
        declared.open(model, cooked, signal);
        invalidate();
      })
      // A read its model let go of by leaving is no failure.
      .catch((error) => signal.aborted || failed(error as EngineError));
  }
  const evict = (p: Placed) => {
    if (p.id < 0) return;
    bodies.release(p.id & BODY_INDEX);
    p.id = -1;
  };
  /** Everything `model` holds out: its tiles and the bodies it declares. */
  const drop = (model: Model, { placed, abort }: Opening) => {
    abort.abort();
    placed.forEach(evict);
    declared.forget(model);
  };
  async function load(p: Placed) {
    const opening = models.get(p.model)!,
      { signal } = opening.abort;
    p.loading = true;
    fetching++;
    try {
      // One request: a tile still wanted is asked again at the next update, but for a 4xx.
      const bytes = await cookedBytes(p.model, p.tile.url, signal, ONE_REQUEST);
      // Its model left, or was opened again meanwhile: this tile is no longer one it holds.
      if (signal.aborted) return;
      p.id = bodies.claim(p.tile.triangles, 0, { model: p.model, tile: p });
      const handle = p.id & BODY_INDEX;
      const { position, quaternion, scale } = tilePose(p);
      // The matter the node's collider declares, over the engine's default, as for every body.
      const matter = physicsMatterOf(p.instance);
      // Restored, built into one static body, and its handle dropped: the body keeps the shape.
      writer.restore(handle, bytes);
      writer.add({
        ...{ id: p.id, motion: MOTION.static, layer: LAYER.static, shape: SHAPE.cooked },
        ...{ flags: 0, position, quaternion, size: [scale.x, scale.y, scale.z] },
        ...{ mass: 0, density: 0, friction: matter.friction, restitution: matter.restitution },
        ...{ gravityScale: 1, indices: [handle] },
      });
      writer.release(handle);
      invalidate();
    } catch (error) {
      // Its model left: the read was let go, which is no failure. A 4xx is not asked at the next
      // update: the tile leaves its opening until its model opens again, as one the worker refused.
      if (signal.aborted) return;
      failed(error as EngineError);
      if (!retriableError(error)) opening.placed.splice(opening.placed.indexOf(p), 1);
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
        if (!models.has(node)) open(node);
      });
      for (const [model, opening] of models)
        if (!seen.has(model)) {
          drop(model, opening);
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
      for (const { placed } of models.values())
        for (const p of placed) {
          let near = boxPointDistance(p.box, 0, eye[0], eye[1], eye[2]);
          if (near > range) near = Infinity;
          for (let m = 0; m < movers.length; m += 4)
            if (
              boxPointDistance(p.box, 0, movers[m], movers[m + 1], movers[m + 2]) <= movers[m + 3]
            )
              near = 0;
          if (near < Infinity && !declared.holds(p.model, p.instance.node)) wanted.push([near, p]);
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
    /** The model a tile body's or a cooked body's engine id belongs to, or `null`. */
    modelOf: bodies.slots.modelOf,
    /** The worker refused body `id`: a tile or a cooked body leaves, its slot and budget
     *  given back, and is not made again until its model opens again; any other body is ignored. */
    refused(id: number) {
      const owner = bodies.slots.of(id);
      if (!owner || !('tile' in owner)) return owner && declared.refused(owner);
      evict(owner.tile);
      const { placed } = models.get(owner.model)!;
      placed.splice(placed.indexOf(owner.tile), 1);
    },
    /** The glTF material of a tile body's triangles, `-1` for none or for another body. */
    materialOf(id: number) {
      const owner = bodies.slots.of(id);
      return owner && 'tile' in owner ? owner.tile.material : -1;
    },
    /** A model moved: its resident tiles and its cooked bodies follow. */
    moved(node: Object3D) {
      node.traverse((child) => {
        if (isModel(child)) declared.moved(child);
        for (const p of (isModel(child) && models.get(child)?.placed) || []) {
          locate(p);
          if (p.id < 0) continue;
          const { position, quaternion } = tilePose(p);
          writer.teleport(p.id & BODY_INDEX, position, quaternion);
        }
      });
    },
    /** Every tile and cooked body out (physics turned off). */
    clear() {
      models.forEach((opening, model) => drop(model, opening));
      models.clear();
    },
  };
}
