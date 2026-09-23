import { posed } from '../movers.ts';
import { BLOCK, FLAG, H, MODES } from '../protocol.ts';
import { carPose } from './car.ts';
import type { Sim } from './core.ts';
import { heightAt } from '../heights.ts';
import { onAsphalt } from '../roads.ts';
import { walkerPose } from './foot.ts';
import { playerPosition } from './player.ts';

/**
 * Reads the simulation out into one snapshot (layout in protocol.ts): the header, the car, the
 * plane, the traffic, the crowd and the movers, positions relative to the physics origin.
 */
export function writeSnapshot(sim: Sim, out: Float32Array) {
  const { physics, layout } = sim;
  const { origin } = physics;
  const [x, y, z] = playerPosition(sim);
  out.fill(0);
  out[H.time] = sim.time;
  out[H.mode] = MODES.indexOf(sim.mode);
  out[H.originX] = origin.x;
  out[H.originZ] = origin.z;
  out.set([x - origin.x, y, z - origin.z], H.x);
  out[H.qw] = 1;
  const feet = walkerPose(physics, sim.walker);
  const ground = heightAt(sim.ground.store, x, z);
  let flags = sim.holding ? FLAG.loading : 0;
  if (sim.mode === 'foot') {
    const v = sim.walker.character.GetLinearVelocity();
    out[H.speed] = Math.hypot(v.GetX(), v.GetZ());
    if (feet.grounded) flags |= FLAG.grounded;
    if (sim.walker.crouched) flags |= FLAG.crouched;
    if (sim.walker.running) flags |= FLAG.running;
  }
  if (sim.car) {
    carPose(physics, sim.car, out, layout.car);
    if (sim.mode === 'car') {
      out.set(out.subarray(layout.car + 3, layout.car + 7), H.qx);
      const v = physics.bodies.GetLinearVelocity(sim.car.body.GetID());
      out[H.speed] = Math.hypot(v.GetX(), v.GetY(), v.GetZ());
      if (onAsphalt(sim.surface, x, z)) flags |= FLAG.asphalt;
    }
  }
  if (sim.plane) {
    const p = sim.plane.position;
    out.set([p[0] - origin.x, p[1], p[2] - origin.z, ...sim.plane.orientation], layout.plane);
    if (sim.mode === 'plane') {
      out.set(sim.plane.orientation, H.qx);
      out[H.speed] = sim.plane.speed;
      out[H.throttle] = sim.plane.throttle;
      if (sim.plane.stalled) flags |= FLAG.stalled;
      if (sim.plane.onGround) flags |= FLAG.grounded;
    }
    out[H.propeller] = sim.plane.throttle;
  }
  out[H.ground] = ground ?? Number.NaN;
  out[H.flags] = flags;
  out[H.stamina] = sim.walker.stamina;
  out[H.carSpawn] = sim.carSpawn;
  out[H.planeSpawn] = sim.planeSpawn;
  out[H.bodies] = sim.ground.bodies.size;
  out[H.cached] = sim.ground.store.tiles.size;
  out[H.stepMs] = sim.stepMs;
  let active = 0;
  for (const [i, car] of sim.flow.cars.entries()) {
    // An idle slot says so with a braking value of −1.
    if (!car.active) {
      out[layout.traffic + i * BLOCK.traffic + 4] = -1;
      continue;
    }
    active++;
    out.set(
      [car.x - origin.x, car.y, car.z - origin.z, car.yaw, car.braking ? 1 : 0],
      layout.traffic + i * BLOCK.traffic,
    );
  }
  out[H.traffic] = active;
  active = 0;
  for (const [i, person] of sim.people.people.entries()) {
    const at = layout.pedestrians + i * BLOCK.pedestrian;
    if (!person.active) {
      out[at + 5] = -1;
      continue;
    }
    active++;
    out.set(
      [person.x - origin.x, person.y, person.z - origin.z, person.yaw, person.phase, person.gait],
      at,
    );
  }
  out[H.pedestrians] = active;
  sim.moving.forEach((moving, i) =>
    posed(moving, sim.time, out, layout.movers + i * BLOCK.mover, origin.x, origin.z),
  );
}
