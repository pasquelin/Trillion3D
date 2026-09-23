import { headingOf } from '../math3.ts';
import {
  nearestRoad,
  polyline,
  roadIndex,
  sampleAt,
  type Polyline,
  type RoadIndex,
} from '../roads.ts';
import type { Road, Settlement } from '../types.ts';
import { seeded } from '../../../random.ts';

/**
 * Pedestrians in the towns and the city: a fixed pool walking the pavements beside the roads,
 * idling now and then, and stepping away from the road when a car comes at them. Only near the player and only inside a settlement; recycled like traffic.
 */
export type Pedestrian = {
  active: boolean;
  road: Road | null;
  s: number;
  dir: 1 | -1;
  /** Which pavement: +1 right of the road's direction, −1 left. */
  side: 1 | -1;
  /** Sideways offset from the pavement line while stepping away from a car, metres. */
  dodge: number;
  idle: number;
  hurry: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
  /** 0 standing, 1 walking, 2 hurrying. */
  gait: number;
};

export type Crowd = {
  people: Pedestrian[];
  next: () => number;
  radius: number;
  places: readonly Settlement[];
  /** Streets and avenues, the roads with pavements. */
  streets: RoadIndex;
  lines: ReadonlyMap<Road, Polyline>;
};

/** A moving car a pedestrian keeps clear of: position and velocity. */
export type Moving = { x: number; z: number; vx: number; vz: number };

const WALK = 1.35;
const HURRY = 3.2;
const STRIDE = 0.72;
const PEOPLED = new Set(['city', 'town', 'village', 'port', 'resort']);

export function crowd(
  count: number,
  seed: number,
  radius: number,
  places: readonly Settlement[],
  roads: readonly Road[],
): Crowd {
  // Pavements run beside the streets and avenues.
  const streets = roads.filter((road) => road.class === 'street' || road.class === 'avenue');
  const people = Array.from({ length: count }, (): Pedestrian => ({
    active: false,
    road: null,
    s: 0,
    dir: 1,
    side: 1,
    dodge: 0,
    idle: 0,
    hurry: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    phase: 0,
    gait: 0,
  }));
  return {
    people,
    next: seeded(seed ^ 0x51ed27),
    radius,
    places: places.filter((p) => PEOPLED.has(p.kind)),
    streets: roadIndex(streets),
    lines: new Map(streets.map((road) => [road, polyline(road.points)])),
  };
}

function place(crowd: Crowd, person: Pedestrian, px: number, pz: number, inner: number) {
  person.active = false;
  const nearby = crowd.places.filter(
    (p) => Math.hypot(p.centre[0] - px, p.centre[2] - pz) < p.radius + crowd.radius,
  );
  if (!nearby.length) return;
  const angle = crowd.next() * 2 * Math.PI;
  const reach = inner + (crowd.radius - inner) * Math.sqrt(crowd.next());
  const [x, z] = [px + Math.cos(angle) * reach, pz + Math.sin(angle) * reach];
  if (!nearby.some((p) => Math.hypot(p.centre[0] - x, p.centre[2] - z) < p.radius)) return;
  const near = nearestRoad(crowd.streets, x, z);
  if (!near || near.distance > 60) return;
  const line = crowd.lines.get(near.road)!;
  Object.assign(person, {
    active: true,
    road: near.road,
    s:
      line.along[near.segment - 1] +
      near.t * (line.along[near.segment] - line.along[near.segment - 1]),
    dir: crowd.next() < 0.5 ? 1 : -1,
    side: crowd.next() < 0.5 ? 1 : -1,
    dodge: 0,
    idle: crowd.next() < 0.3 ? 2 + crowd.next() * 5 : 0,
    hurry: 0,
    phase: crowd.next() * 2 * Math.PI,
  });
}

/** One step of every pedestrian around the player at (px, pz), clear of `cars`. */
export function stepCrowd(
  crowd: Crowd,
  px: number,
  pz: number,
  cars: readonly Moving[],
  dt: number,
) {
  for (const person of crowd.people) {
    if (!person.active || Math.hypot(person.x - px, person.z - pz) > crowd.radius) {
      place(crowd, person, px, pz, person.active ? crowd.radius * 0.6 : 10);
      if (!person.active) continue;
    }
    const road = person.road!;
    const line = crowd.lines.get(road)!;
    // A car within ten metres closing on the pedestrian sends them briskly away from the road.
    for (const car of cars) {
      const [rx, rz] = [person.x - car.x, person.z - car.z];
      const distance = Math.hypot(rx, rz);
      if (distance < 10 && rx * car.vx + rz * car.vz > 0.5 * distance) person.hurry = 1.2;
    }
    let speed = 0;
    if (person.hurry > 0) {
      person.hurry -= dt;
      person.dodge = Math.min(3, person.dodge + HURRY * dt);
      speed = HURRY;
    } else if (person.idle > 0) {
      person.idle -= dt;
      person.dodge = Math.max(0, person.dodge - WALK * dt);
    } else {
      speed = WALK;
      person.dodge = Math.max(0, person.dodge - WALK * dt);
      person.s += person.dir * WALK * dt;
      if (person.s <= 0 || person.s >= line.length) {
        person.dir = person.dir > 0 ? -1 : 1;
        person.idle = 1 + crowd.next() * 3;
      } else if (crowd.next() < dt / 40) person.idle = 2 + crowd.next() * 6;
    }
    const { position, direction } = sampleAt(line, person.s);
    const offset = person.side * (road.width / 2 + 1.5 + person.dodge);
    const [dx, dz] = [direction[0] * person.dir, direction[2] * person.dir];
    person.x = position[0] - direction[2] * offset;
    person.z = position[2] + direction[0] * offset;
    person.y = position[1] + 0.15;
    person.yaw =
      person.hurry > 0
        ? headingOf(-direction[2] * person.side, direction[0] * person.side)
        : headingOf(dx, dz);
    person.phase += (speed / STRIDE) * Math.PI * dt;
    person.gait = person.hurry > 0 ? 2 : speed > 0 ? 1 : 0;
  }
}
