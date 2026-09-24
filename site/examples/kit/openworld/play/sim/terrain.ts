import type JoltModule from 'jolt-physics/wasm';
import {
  planStream,
  tileCorner,
  parseKey,
  type Grid,
  type StreamLimits,
  type TileKey,
} from '../grid.ts';
import { fetchTile, type HeightStore } from '../heights.ts';
import type { ColliderInstance, CollisionMesh } from '../collision.ts';
import { LAYER, type Physics } from './physics.ts';
import { loadSolids, placedCompound, solids, type Solids } from './solids.ts';

/**
 * The ground the physics stands on, streamed by tile around the player: one static heightfield
 * per tile, and one static compound of the props placed on it (`solids.ts`). Heights are
 * fetched ahead of the player's travel; bodies are built a few per step, nearest first; nothing
 * waits on a fetch.
 */
export type Terrain = {
  store: HeightStore;
  bodies: Map<TileKey, JoltModule.BodyID[]>;
  placed: Map<TileKey, readonly ColliderInstance[]>;
  solids: Solids;
  limits: StreamLimits;
};

export type TileSource = {
  heights(tx: number, tz: number): Promise<Float32Array>;
  /** The tile's solid placements and each placed prop's collision mesh; none when omitted. */
  colliders?: {
    tile(tx: number, tz: number): Promise<readonly ColliderInstance[]>;
    mesh(prop: string): Promise<CollisionMesh>;
  };
};

export function terrain(store: HeightStore, radius: number): Terrain {
  // One body a step (sixty tiles a second) keeps each step short whatever the tiles' size.
  const limits = { radius, lookahead: 12, fetches: 6, builds: 1, cache: 96 };
  return { store, bodies: new Map(), placed: new Map(), solids: solids(), limits };
}

function addBody(physics: Physics, settings: JoltModule.ShapeSettings, at: JoltModule.RVec3) {
  const { J, bodies } = physics;
  const shape = settings.Create().Get();
  const creation = new J.BodyCreationSettings(
    shape,
    at,
    J.Quat.prototype.sIdentity(),
    J.EMotionType_Static,
    LAYER.static,
  );
  // Tyres grip the ground as on dry asphalt; the engine's off-road penalty is the car's own.
  creation.mFriction = 1;
  const body = bodies.CreateBody(creation);
  J.destroy(creation);
  bodies.AddBody(body.GetID(), J.EActivation_DontActivate);
  return body.GetID();
}

function heightfield(
  physics: Physics,
  heights: Float32Array,
  samples: number,
  grid: Grid,
  key: TileKey,
) {
  const { J, origin } = physics;
  const settings = new J.HeightFieldShapeSettings();
  const count = samples + 1;
  settings.mSampleCount = count;
  settings.mBlockSize = 4;
  const step = grid.tile / samples;
  settings.mScale.Set(step, 1, step);
  settings.mHeightSamples.resize(count * count);
  const pointer = J.getPointer(settings.mHeightSamples.data()) / 4;
  J.HEAPF32.set(heights, pointer);
  const [minX, minZ] = tileCorner(grid, ...parseKey(key));
  const at = new J.RVec3(minX - origin.x, 0, minZ - origin.z);
  const id = addBody(physics, settings, at);
  J.destroy(at);
  J.destroy(settings);
  return id;
}

/**
 * One streaming step for a player at world (x, z) moving at (vx, vz): starts fetches, builds a
 * few bodies from heights that arrived, releases far ones, drops far heights.
 */
export function streamTerrain(
  physics: Physics,
  ground: Terrain,
  source: TileSource,
  at: { x: number; z: number; vx: number; vz: number },
) {
  const { store } = ground;
  const plan = planStream(
    store.grid,
    at,
    {
      cached: new Set(store.tiles.keys()),
      fetching: store.fetching,
      built: new Set(ground.bodies.keys()),
      failed: store.failed,
    },
    ground.limits,
  );
  // A tile's heights land in the store only once its placements and their meshes have too.
  const load = async (tx: number, tz: number) => {
    const { colliders } = source;
    const placements = async () => {
      if (!colliders) return;
      const placed = await colliders.tile(tx, tz);
      await loadSolids(ground.solids, colliders.mesh, placed);
      ground.placed.set(`${tx}_${tz}`, placed);
    };
    const [heights] = await Promise.all([source.heights(tx, tz), placements()]);
    return heights;
  };
  for (const key of plan.fetch) fetchTile(store, key, load);
  for (const key of plan.build) {
    const ids = [heightfield(physics, store.tiles.get(key)!, store.samples, store.grid, key)];
    const props = placedCompound(physics, ground.solids, ground.placed.get(key) ?? []);
    if (props) {
      const at = new physics.J.RVec3(0, 0, 0);
      ids.push(addBody(physics, props, at));
      for (const made of [at, props]) physics.J.destroy(made);
    }
    ground.bodies.set(key, ids);
  }
  for (const key of plan.release) {
    for (const id of ground.bodies.get(key) ?? []) {
      physics.bodies.RemoveBody(id);
      physics.bodies.DestroyBody(id);
    }
    ground.bodies.delete(key);
  }
  for (const key of plan.evict) {
    store.tiles.delete(key);
    ground.placed.delete(key);
  }
}
