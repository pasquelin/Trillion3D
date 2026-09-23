import type JoltModule from 'jolt-physics/wasm';

/**
 * One Jolt physics system for the simulated area around the player: two object layers (the
 * static world, and what moves), the filters the character and the vehicle query with, and a
 * floating origin. Jolt's WebAssembly build is single precision, so bodies live near the
 * origin and the origin follows the player by whole tiles.
 */
export type Jolt = typeof JoltModule;
export const LAYER = { static: 0, moving: 1 } as const;

export type Physics = {
  J: Jolt;
  jolt: JoltModule.JoltInterface;
  system: JoltModule.PhysicsSystem;
  bodies: JoltModule.BodyInterface;
  /** Filters for queries made by what moves. */
  filters: {
    broad: JoltModule.DefaultBroadPhaseLayerFilter;
    object: JoltModule.DefaultObjectLayerFilter;
    body: JoltModule.BodyFilter;
    shape: JoltModule.ShapeFilter;
  };
  gravity: JoltModule.Vec3;
  /** World position of the physics origin, metres; a multiple of the tile. */
  origin: { x: number; z: number };
};

export function createPhysics(J: Jolt): Physics {
  const pairs = new J.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(LAYER.static, LAYER.moving);
  pairs.EnableCollision(LAYER.moving, LAYER.moving);
  const staticBroad = new J.BroadPhaseLayer(0);
  const movingBroad = new J.BroadPhaseLayer(1);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  broad.MapObjectToBroadPhaseLayer(LAYER.static, staticBroad);
  broad.MapObjectToBroadPhaseLayer(LAYER.moving, movingBroad);
  const settings = new J.JoltSettings();
  settings.mMaxBodies = 4096;
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = broad;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(
    broad,
    2,
    pairs,
    2,
  );
  const jolt = new J.JoltInterface(settings);
  J.destroy(settings);
  const system = jolt.GetPhysicsSystem();
  const gravity = new J.Vec3(0, -9.81, 0);
  system.SetGravity(gravity);
  return {
    J,
    jolt,
    system,
    bodies: system.GetBodyInterface(),
    filters: {
      broad: new J.DefaultBroadPhaseLayerFilter(
        jolt.GetObjectVsBroadPhaseLayerFilter(),
        LAYER.moving,
      ),
      object: new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), LAYER.moving),
      body: new J.BodyFilter(),
      shape: new J.ShapeFilter(),
    },
    gravity,
    origin: { x: 0, z: 0 },
  };
}

/**
 * Moves the origin to the tile corner nearest (x, z) once the player is farther than `reach`
 * from it, shifting every body by the opposite amount. Returns the shift, zero when none.
 */
export function followOrigin(physics: Physics, x: number, z: number, tile: number, reach: number) {
  const { origin, J } = physics;
  if (Math.hypot(x - origin.x, z - origin.z) < reach) return [0, 0] as const;
  const next = { x: Math.round(x / tile) * tile, z: Math.round(z / tile) * tile };
  const dx = next.x - origin.x;
  const dz = next.z - origin.z;
  const ids = new J.BodyIDVector();
  physics.system.GetBodies(ids);
  for (let i = 0; i < ids.size(); i++) {
    const id = ids.at(i);
    const at = physics.bodies.GetPosition(id);
    const moved = new J.RVec3(at.GetX() - dx, at.GetY(), at.GetZ() - dz);
    physics.bodies.SetPosition(id, moved, J.EActivation_DontActivate);
    J.destroy(moved);
  }
  J.destroy(ids);
  physics.system.OptimizeBroadPhase();
  origin.x = next.x;
  origin.z = next.z;
  return [dx, dz] as const;
}
