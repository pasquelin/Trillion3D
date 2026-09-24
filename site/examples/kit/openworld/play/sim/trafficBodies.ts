import type JoltModule from 'jolt-physics/wasm';
import { LAYER, type Physics } from './physics.ts';
import type { Traffic } from './traffic.ts';

/**
 * The traffic as the physics feels it: one kinematic box per car of the pool, driven to where
 * the traffic put the car, so the player's car and the walker bump into it instead of passing
 * through. An idle car's box waits far below the ground.
 */
const HALF = [0.9, 0.7, 2.2] as const;
const PARKED_DEPTH = -10_000;

export type TrafficBodies = {
  ids: JoltModule.BodyID[];
  at: JoltModule.RVec3;
  up: JoltModule.Vec3;
};

export function trafficBodies(physics: Physics, count: number): TrafficBodies {
  const { J, bodies } = physics;
  const half = new J.Vec3(...HALF);
  const shape = new J.BoxShapeSettings(half).Create().Get();
  const at = new J.RVec3(0, PARKED_DEPTH, 0);
  const ids = Array.from({ length: count }, () => {
    const creation = new J.BodyCreationSettings(
      shape,
      at,
      J.Quat.prototype.sIdentity(),
      J.EMotionType_Kinematic,
      LAYER.moving,
    );
    const body = bodies.CreateBody(creation);
    J.destroy(creation);
    bodies.AddBody(body.GetID(), J.EActivation_DontActivate);
    return body.GetID();
  });
  J.destroy(half);
  return { ids, at, up: new J.Vec3(0, 1, 0) };
}

/** Sends each box towards its car for the next step; a car that jumped (recycled) is moved at once. */
export function driveTrafficBodies(
  physics: Physics,
  boxes: TrafficBodies,
  flow: Traffic,
  dt: number,
) {
  const { J, bodies, origin } = physics;
  flow.cars.forEach((car, i) => {
    const id = boxes.ids[i];
    const now = bodies.GetPosition(id);
    if (!car.active) {
      if (now.GetY() > PARKED_DEPTH + 1) {
        boxes.at.Set(0, PARKED_DEPTH, 0);
        bodies.SetPosition(id, boxes.at, J.EActivation_DontActivate);
      }
      return;
    }
    const [x, y, z] = [car.x - origin.x, car.y + HALF[1], car.z - origin.z];
    const jumped = Math.hypot(now.GetX() - x, now.GetY() - y, now.GetZ() - z) > 20;
    boxes.at.Set(x, y, z);
    const turn = J.Quat.prototype.sRotation(boxes.up, car.yaw);
    if (jumped) bodies.SetPositionAndRotation(id, boxes.at, turn, J.EActivation_DontActivate);
    else bodies.MoveKinematic(id, boxes.at, turn, dt);
  });
}
