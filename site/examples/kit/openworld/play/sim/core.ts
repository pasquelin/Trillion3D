import { heightAt, heightStore } from '../heights.ts';
import { movingWorld, type Moving } from '../movers.ts';
import {
  idleInputs,
  layout,
  type Inputs,
  type Layout,
  type SimLimits,
  type SimWorld,
} from '../protocol.ts';
import { onAsphalt, roadIndex } from '../roads.ts';
import type { Mode } from '../types.ts';
import { drive, type Car } from './car.ts';
import { fly, type Aircraft } from './flight.ts';
import { stepWalker, walker, walkerPose, type Walker } from './foot.ts';
import { crowd, stepCrowd, type Crowd } from './pedestrians.ts';
import { createPhysics, followOrigin, type Jolt, type Physics } from './physics.ts';
import { roadGraph, type RoadGraph } from './roadGraph.ts';
import { streamTerrain, terrain, type Terrain, type TileSource } from './terrain.ts';
import { stepTraffic, traffic, type Traffic } from './traffic.ts';
import { driveTrafficBodies, trafficBodies, type TrafficBodies } from './trafficBodies.ts';
import { enterOrLeave, groundReady, playerPosition, settle, startPlace } from './player.ts';

/**
 * The simulation, free of any worker or page: the worker shell steps it, a Node test steps it the
 * same way. `step` advances one fixed step; `writeSnapshot` (snapshot.ts) reads it out.
 */
export type Sim = {
  world: SimWorld;
  limits: SimLimits;
  layout: Layout;
  physics: Physics;
  ground: Terrain;
  source: TileSource;
  graph: RoadGraph;
  surface: ReturnType<typeof roadIndex>;
  flow: Traffic;
  boxes: TrafficBodies;
  people: Crowd;
  moving: Moving[];
  time: number;
  mode: Mode;
  walker: Walker;
  car: Car | null;
  carSpawn: number;
  plane: Aircraft | null;
  planeSpawn: number;
  /**
   * Set when the walker is put somewhere new: once its ground is known, it is lifted onto it
   * (`keep`: no lower than where it was put, a rooftop stays a rooftop) or dropped to it (`ground`).
   */
  settling: false | 'keep' | 'ground';
  /** The player's position at the previous step, for its velocity. */
  last: [number, number, number] | null;
  /** The player waits for its ground to arrive (shown as loading). */
  holding: boolean;
  inputs: Inputs;
  used: number;
  stepMs: number;
};

export function createSim(J: Jolt, world: SimWorld, limits: SimLimits, source: TileSource): Sim {
  const physics = createPhysics(J);
  const store = heightStore({ size: world.size, tile: world.tile }, world.heightSamples);
  const graph = roadGraph(world.roads);
  const moving = movingWorld(world.movers, world.roads);
  const [x, y, z] = startPlace(world);
  return {
    world,
    limits,
    layout: layout(limits, moving.length),
    physics,
    ground: terrain(store, limits.radius),
    source,
    graph,
    surface: roadIndex(
      world.roads.filter((road) => road.class !== 'runway' && road.class !== 'taxiway'),
    ),
    flow: traffic(limits.traffic, world.seed, Math.min(limits.radius, 1500)),
    boxes: trafficBodies(physics, limits.traffic),
    people: crowd(limits.pedestrians, world.seed, 350, world.settlements, world.roads),
    moving,
    time: 0,
    mode: 'foot',
    walker: walker(physics, x, y, z),
    car: null,
    carSpawn: -1,
    plane: null,
    planeSpawn: -1,
    settling: 'keep',
    last: null,
    holding: true,
    inputs: idleInputs(),
    used: 0,
    stepMs: 0,
  };
}

/** Ground height at world (x, z) for what flies: the heightfield, the sea where none arrived. */
const groundAt = (sim: Sim, x: number, z: number) =>
  Math.max(0, heightAt(sim.ground.store, x, z) ?? 0);

/** One fixed step: stream the ground, move the player in its mode, the traffic and the crowd. */
export function step(sim: Sim, inputs: Inputs, dt: number) {
  const started = performance.now();
  sim.inputs = inputs;
  const { physics } = sim;
  const at = motion(sim, dt);
  const [dx, dz] = followOrigin(physics, at.x, at.z, sim.world.tile, 2 * sim.world.tile);
  if (dx || dz) {
    const feet = walkerPose(physics, sim.walker);
    const moved = new physics.J.RVec3(feet.x - dx, feet.y, feet.z - dz);
    sim.walker.character.SetPosition(moved);
    physics.J.destroy(moved);
  }
  streamTerrain(physics, sim.ground, sim.source, at);
  if (inputs.use !== sim.used) enterOrLeave(sim);
  sim.used = inputs.use;
  const asphalt = onAsphalt(sim.surface, at.x, at.z);
  sim.holding = false;
  if (sim.car) {
    // A car whose ground has not arrived waits in the air, asleep, instead of falling through.
    const { x, z } = carObstacle(sim);
    if (groundReady(sim, x, z))
      drive(physics, sim.car, sim.mode === 'car' ? inputs : null, asphalt);
    else {
      physics.bodies.DeactivateBody(sim.car.body.GetID());
      sim.holding = sim.mode === 'car';
    }
  }
  if (sim.mode === 'foot') {
    if (settle(sim)) stepWalker(physics, sim.walker, inputs, dt);
    else sim.holding = true;
  }
  // A press of Space in a vehicle or while the ground loads is no jump waiting for later.
  sim.walker.jumps = inputs.jump;
  if (sim.mode === 'plane' && sim.plane)
    fly(
      sim.plane,
      {
        throttle: inputs.throttle,
        pitch: inputs.pitch,
        roll: inputs.roll,
        yaw: inputs.yaw,
        brake: inputs.brake,
      },
      dt,
      (x, z) => groundAt(sim, x, z),
    );
  physics.jolt.Step(dt, 1);
  // Traffic stops for the player's car, for the player on foot and for pedestrians.
  const player = sim.car ? [carObstacle(sim)] : [];
  if (sim.mode === 'foot') player.push({ x: at.x, z: at.z, vx: 0, vz: 0 });
  stepTraffic(
    sim.graph,
    sim.flow,
    at.x,
    at.z,
    [...player, ...sim.people.people.filter((p) => p.active)],
    dt,
  );
  driveTrafficBodies(physics, sim.boxes, sim.flow, dt);
  const cars = sim.flow.cars
    .filter((car) => car.active)
    .map((car) => ({
      x: car.x,
      z: car.z,
      vx: -Math.sin(car.yaw) * car.speed,
      vz: -Math.cos(car.yaw) * car.speed,
    }));
  if (sim.car) cars.push(carObstacle(sim));
  stepCrowd(sim.people, at.x, at.z, cars, dt);
  sim.time += dt;
  sim.stepMs = performance.now() - started;
}

/** The player's position and ground velocity over the last step, bounded so a teleport is no leap ahead. */
function motion(sim: Sim, dt: number) {
  const [x, y, z] = playerPosition(sim);
  const [lx, , lz] = sim.last ?? [x, y, z];
  sim.last = [x, y, z];
  let [vx, vz] = [(x - lx) / dt, (z - lz) / dt];
  const speed = Math.hypot(vx, vz);
  if (speed > 300) [vx, vz] = [(vx / speed) * 300, (vz / speed) * 300];
  return { x, y, z, vx, vz };
}

/** The player's car as traffic and pedestrians see it: where it is, how fast it goes. */
function carObstacle(sim: Sim) {
  const { bodies, origin } = sim.physics;
  const id = sim.car!.body.GetID();
  const [p, v] = [bodies.GetPosition(id), bodies.GetLinearVelocity(id)];
  return { x: p.GetX() + origin.x, z: p.GetZ() + origin.z, vx: v.GetX(), vz: v.GetZ() };
}
