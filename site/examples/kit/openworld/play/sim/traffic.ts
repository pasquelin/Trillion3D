import { headingOf } from '../math3.ts';
import { nearestRoad, sampleAt } from '../roads.ts';
import { mulberry32 } from '../../../random.ts';
import { CRUISE, type RoadGraph } from './roadGraph.ts';

/**
 * Traffic: a fixed pool of cars driving the road graph around the player, recycled when they
 * fall behind. Each keeps to the right-hand lane, keeps its distance to the car ahead, stops at a
 * junction before turning onto a linked road, and stops for what stands in its lane (a
 * pedestrian, the player's car). Deterministic from the seed.
 */
export type TrafficCar = {
  road: number;
  /** Metres along the road, and the way it drives it (+1 from start to end, −1 back). */
  s: number;
  dir: 1 | -1;
  speed: number;
  /** Seconds left standing at a junction's stop line. */
  wait: number;
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  braking: boolean;
};

export type Traffic = { cars: TrafficCar[]; next: () => number; radius: number };

/** Something a car stops for: where it stands. */
export type Obstacle = { x: number; z: number };

const GAP = 7;
const HEADWAY = 1.2;
const STOP_WAIT = 1.2;

export function traffic(count: number, seed: number, radius: number): Traffic {
  const cars = Array.from({ length: count }, () => ({
    road: 0,
    s: 0,
    dir: 1 as const,
    speed: 0,
    wait: 0,
    active: false,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    braking: false,
  }));
  return { cars, next: mulberry32(seed ^ 0x7a5f1c), radius };
}

/** Puts a car on a road at a random place in the ring [inner, radius] around (px, pz). */
function place(
  graph: RoadGraph,
  flow: Traffic,
  car: TrafficCar,
  px: number,
  pz: number,
  inner: number,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = flow.next() * 2 * Math.PI;
    const reach = inner + (flow.radius - inner) * Math.sqrt(flow.next());
    const near = nearestRoad(
      graph.index,
      px + Math.cos(angle) * reach,
      pz + Math.sin(angle) * reach,
    );
    if (!near || Math.hypot(near.point[0] - px, near.point[2] - pz) > flow.radius) continue;
    const road = graph.number.get(near.road)!;
    const line = graph.lines[road];
    car.road = road;
    car.s =
      line.along[near.segment - 1] +
      near.t * (line.along[near.segment] - line.along[near.segment - 1]);
    car.dir = flow.next() < 0.5 ? 1 : -1;
    car.speed = CRUISE[near.road.class] * 0.6;
    car.wait = 0;
    car.active = true;
    return;
  }
  car.active = false;
}

function pose(graph: RoadGraph, car: TrafficCar) {
  const road = graph.roads[car.road];
  const { position, direction } = sampleAt(graph.lines[car.road], car.s);
  const [dx, dz] = [direction[0] * car.dir, direction[2] * car.dir];
  const lane = road.width / 4;
  car.x = position[0] - dz * lane;
  car.y = position[1];
  car.z = position[2] + dx * lane;
  car.yaw = headingOf(dx, dz);
}

/** Turns onto a road linked at the end the car reached, or back along its own when none is. */
function turn(graph: RoadGraph, flow: Traffic, car: TrafficCar) {
  const links = graph.ends[car.road][car.dir > 0 ? 1 : 0];
  if (!links.length) {
    car.dir = car.dir > 0 ? -1 : 1;
    return;
  }
  const link = links[Math.floor(flow.next() * links.length)];
  const length = graph.lines[link.road].length;
  car.road = link.road;
  car.s = link.at;
  car.dir = link.at < 1 ? 1 : link.at > length - 1 ? -1 : flow.next() < 0.5 ? 1 : -1;
}

/** The distance to the nearest obstacle in the car's lane ahead, within `look` metres. */
function clearance(flow: Traffic, car: TrafficCar, obstacles: readonly Obstacle[], look: number) {
  const [fx, fz] = [-Math.sin(car.yaw), -Math.cos(car.yaw)];
  let nearest = Infinity;
  const check = (x: number, z: number, width: number) => {
    const [rx, rz] = [x - car.x, z - car.z];
    const ahead = rx * fx + rz * fz;
    if (ahead > 0 && ahead < look && Math.abs(rx * -fz + rz * fx) < width)
      nearest = Math.min(nearest, ahead);
  };
  for (const other of flow.cars) if (other !== car && other.active) check(other.x, other.z, 1.6);
  for (const obstacle of obstacles) check(obstacle.x, obstacle.z, 2.2);
  return nearest;
}

/** One step of every car around the player at (px, pz). */
export function stepTraffic(
  graph: RoadGraph,
  flow: Traffic,
  px: number,
  pz: number,
  obstacles: readonly Obstacle[],
  dt: number,
) {
  if (!graph.roads.length) return;
  for (const car of flow.cars) {
    if (!car.active || Math.hypot(car.x - px, car.z - pz) > flow.radius) {
      // A car that fell behind comes back beyond the player's near view.
      place(graph, flow, car, px, pz, car.active ? flow.radius * 0.6 : 60);
      if (car.active) pose(graph, car);
      continue;
    }
    const road = graph.roads[car.road];
    const line = graph.lines[car.road];
    const cruise = CRUISE[road.class];
    const toEnd = car.dir > 0 ? line.length - car.s : car.s;
    let wanted = cruise;
    const gap = clearance(flow, car, obstacles, cruise * 3 + GAP);
    if (gap < Infinity) wanted = Math.min(wanted, Math.max(0, (gap - GAP) / HEADWAY));
    // A road that simply goes on is driven through; at a real junction or a dead end the car
    // brakes to a stop line two metres before it, stands, then turns.
    const through = graph.ends[car.road][car.dir > 0 ? 1 : 0].length === 1;
    if (!through) wanted = Math.min(wanted, Math.sqrt(Math.max(0, 2 * 4 * (toEnd - 2))));
    if (through && toEnd < 0.5) turn(graph, flow, car);
    else if (!through && toEnd < 3 && car.speed < 0.5) {
      car.wait = Math.max(0, (car.wait || STOP_WAIT) - dt);
      if (car.wait < dt) {
        turn(graph, flow, car);
        car.wait = 0;
      }
    }
    const change = wanted - car.speed;
    car.braking = change < -0.5 * dt;
    car.speed = Math.max(0, car.speed + Math.min(2.5 * dt, Math.max(-6 * dt, change)));
    const length = graph.lines[car.road].length;
    car.s = Math.min(length, Math.max(0, car.s + car.dir * car.speed * dt));
    pose(graph, car);
  }
}
