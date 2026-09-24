import { tileIndex, tileKey } from '../grid.ts';
import { heightAt } from '../heights.ts';
import { rotate } from '../math3.ts';
import { REACH, spawnsOf, type SimWorld } from '../protocol.ts';
import { car, removeCar } from './car.ts';
import type { Sim } from './core.ts';
import { aircraft, AIRCRAFT } from './flight.ts';
import { placeWalker, walkerPose } from './foot.ts';

/**
 * The player between modes: where they are, getting in and out of the vehicles parked at the
 * spawn markers, and teleports. A vehicle left behind stays where it
 * was left; taking another spawn's vehicle sends the first one home.
 */
/** Where the world starts: the first teleport marker, else the first spawn, else the centre. */
export function startPlace(world: SimWorld): [number, number, number] {
  const marker =
    world.markers.find((m) => m.kind === 'teleport') ??
    world.markers.find((m) => m.kind === 'spawn');
  return marker ? [...marker.position] : [0, 0, 0];
}

/** The player's world position: the feet on foot, the body in a vehicle. */
export function playerPosition(sim: Sim): [number, number, number] {
  const { origin } = sim.physics;
  if (sim.mode === 'plane' && sim.plane) return [...sim.plane.position];
  if (sim.mode === 'car' && sim.car) {
    const p = sim.car.body.GetPosition();
    return [p.GetX() + origin.x, p.GetY(), p.GetZ() + origin.z];
  }
  const feet = walkerPose(sim.physics, sim.walker);
  return [feet.x + origin.x, feet.y, feet.z + origin.z];
}

/** Whether the ground at world (x, z) is built into the physics yet. */
export function groundReady(sim: Sim, x: number, z: number) {
  const grid = sim.ground.store.grid;
  return sim.ground.bodies.has(tileKey(tileIndex(grid, x), tileIndex(grid, z)));
}

/** Whether the walker may move: its tile's ground is built. A settling walker is put on it first. */
export function settle(sim: Sim) {
  const { physics, walker, ground } = sim;
  const feet = walkerPose(physics, walker);
  const [x, z] = [feet.x + physics.origin.x, feet.z + physics.origin.z];
  if (!groundReady(sim, x, z)) return false;
  const floor = heightAt(ground.store, x, z);
  // A walker that fell through while its ground was rebuilt is put back on it.
  if (floor !== null && (sim.settling || feet.y < floor - 1.5)) {
    const y = sim.settling === 'keep' ? Math.max(floor, feet.y) : floor;
    placeWalker(physics, walker, feet.x, y + 0.05, feet.z);
  }
  sim.settling = false;
  return true;
}

function putWalker(sim: Sim, x: number, y: number, z: number, settling: Sim['settling'] = 'keep') {
  const { origin } = sim.physics;
  placeWalker(sim.physics, sim.walker, x - origin.x, y, z - origin.z);
  sim.settling = settling;
  sim.mode = 'foot';
}

/** Leaves the vehicle on its left side (whatever its speed: a teleport may ask it in flight). */
function leave(sim: Sim) {
  const { origin } = sim.physics;
  if (sim.mode === 'car' && sim.car) {
    const p = sim.car.body.GetPosition();
    const r = sim.car.body.GetRotation();
    const left = rotate([r.GetX(), r.GetY(), r.GetZ(), r.GetW()], [-2.5, 0, 0]);
    putWalker(sim, p.GetX() + origin.x + left[0], p.GetY() + 0.5, p.GetZ() + origin.z + left[2]);
  } else if (sim.mode === 'plane' && sim.plane) {
    const [x, y, z] = sim.plane.position;
    if (!sim.plane.onGround) {
      // Out of a plane in flight: the walker lands below, and the plane goes back to its spawn.
      sim.plane = null;
      sim.planeSpawn = -1;
      putWalker(sim, x, y, z, 'ground');
      return;
    }
    const left = rotate(sim.plane.orientation, [-7, 0, 0]);
    putWalker(sim, x + left[0], y - AIRCRAFT.gear, z + left[2]);
  }
}

function takeCar(sim: Sim, spawn: number) {
  const marker = spawnsOf(sim.world.markers, 'car')[spawn];
  if (sim.car) removeCar(sim.physics, sim.car);
  const { origin } = sim.physics;
  const [x, y, z] = marker.position;
  sim.car = car(
    sim.physics,
    sim.world.car.wheels,
    [x - origin.x, y + 1, z - origin.z],
    marker.yaw,
    sim.world.car.mass,
  );
  sim.carSpawn = spawn;
}

function takePlane(sim: Sim, spawn: number) {
  const marker = spawnsOf(sim.world.markers, 'plane')[spawn];
  const [x, y, z] = marker.position;
  sim.plane = aircraft([x, y + AIRCRAFT.gear, z], marker.yaw);
  sim.planeSpawn = spawn;
}

/** The vehicle within reach of the walker: the player's own where it was left, or a parked one. */
function within(sim: Sim, kind: 'car' | 'plane', x: number, z: number) {
  const { origin } = sim.physics;
  const own = kind === 'car' ? sim.car && sim.car.body.GetPosition() : null;
  const at = own
    ? [own.GetX() + origin.x, own.GetZ() + origin.z]
    : kind === 'plane' && sim.plane
      ? [sim.plane.position[0], sim.plane.position[2]]
      : null;
  if (at && Math.hypot(at[0] - x, at[1] - z) < REACH[kind]) return 'own';
  const taken = kind === 'car' ? sim.carSpawn : sim.planeSpawn;
  const spawns = spawnsOf(sim.world.markers, kind);
  const index = spawns.findIndex(
    (s, i) => i !== taken && Math.hypot(s.position[0] - x, s.position[2] - z) < REACH[kind],
  );
  return index < 0 ? null : index;
}

/** The E key: in or out of the vehicle at hand. */
export function enterOrLeave(sim: Sim) {
  // Out of the car at any speed (it brakes on its own); out of the plane once it stands still.
  if (sim.mode === 'car' || sim.mode === 'plane') {
    if (sim.mode === 'car' || (sim.plane?.onGround && sim.plane.speed < 3)) leave(sim);
    return;
  }
  const [x, , z] = playerPosition(sim);
  for (const kind of ['car', 'plane'] as const) {
    const found = within(sim, kind, x, z);
    if (found === null) continue;
    if (found !== 'own') (kind === 'car' ? takeCar : takePlane)(sim, found);
    sim.mode = kind;
    return;
  }
}

/** A teleport marker: on foot there, out of any vehicle. */
export function teleport(sim: Sim, name: string) {
  const marker = sim.world.markers.find((m) => m.kind === 'teleport' && m.name === name);
  if (!marker) return;
  const [x, y, z] = marker.position;
  leave(sim);
  putWalker(sim, x, y, z);
}
