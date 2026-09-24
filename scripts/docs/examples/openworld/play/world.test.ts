import assert from 'node:assert/strict';
import test from 'node:test';
import { movingWorld, posed } from '../../../../../site/examples/kit/openworld/play/movers.ts';
import {
  nearestRoad,
  onAsphalt,
  polyline,
  roadIndex,
  sampleAt,
  travel,
} from '../../../../../site/examples/kit/openworld/play/roads.ts';
import {
  crowd,
  stepCrowd,
} from '../../../../../site/examples/kit/openworld/play/sim/pedestrians.ts';
import { roadGraph } from '../../../../../site/examples/kit/openworld/play/sim/roadGraph.ts';
import {
  stepTraffic,
  traffic,
} from '../../../../../site/examples/kit/openworld/play/sim/traffic.ts';
import { fixtureWorld, ROADS } from './fixture.ts';

const STEP = 1 / 60;

test('a line is followed by distance, looped or back and forth', () => {
  const line = polyline([
    [0, 0, 0],
    [100, 0, 0],
    [100, 0, 50],
  ]);
  assert.equal(line.length, 150);
  assert.deepEqual(sampleAt(line, 120), { position: [100, 0, 20], direction: [0, 0, 1] });
  assert.deepEqual(travel(line, 170, true).position, [20, 0, 0]);
  const back = travel(line, 170, false);
  assert.deepEqual(back.position, [100, 0, 30]);
  assert.deepEqual(back.direction, [-0, -0, -1]);
});

test('the nearest road is found around a point, and asphalt ends at its edge', () => {
  const index = roadIndex(ROADS);
  const near = nearestRoad(index, 150, -296)!;
  assert.equal(near.road.id, 'north');
  assert.ok(Math.abs(near.distance - 4) < 1e-9);
  assert.equal(onAsphalt(index, 150, -297), true);
  assert.equal(onAsphalt(index, 150, -290), false);
  assert.equal(nearestRoad(index, 3000, -3000), null);
});

test('each runway gets a touch-and-go circuit that starts and ends on its threshold', () => {
  const world = movingWorld(fixtureWorld().movers, ROADS);
  const circuit = world.find(({ mover }) => mover.name === 'circuit runway')!;
  assert.equal(world.length, 3);
  const out = new Float32Array(7);
  posed(circuit, 0, out, 0);
  assert.deepEqual([...out.slice(0, 3)].map(Math.round), [1000, 30, 2000]);
  posed(circuit, circuit.line!.length / 70, out, 0);
  assert.deepEqual([...out.slice(0, 3)].map(Math.round), [1000, 30, 2000]);
  // Halfway round it flies the circuit's height.
  posed(circuit, circuit.line!.length / 140, out, 0);
  assert.ok(out[1] > 250);
});

test('traffic stays around the player as it travels, recycled, and the same from the same seed', () => {
  const graph = roadGraph(ROADS);
  const run = () => {
    const flow = traffic(16, 332, 1500);
    const seen: number[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      const px = -2500 + i * 0.8;
      stepTraffic(graph, flow, px, 0, [], STEP);
      for (const car of flow.cars)
        if (car.active) assert.ok(Math.hypot(car.x - px, car.z) <= 1500 + 30 * STEP + 1e-6);
      seen.push(flow.cars.filter((car) => car.active).length);
    }
    return { flow, seen };
  };
  const [a, b] = [run(), run()];
  assert.deepEqual(
    a.flow.cars.map((car) => [car.road, car.s]),
    b.flow.cars.map((car) => [car.road, car.s]),
  );
  assert.ok(Math.max(...a.seen) === 16 && a.seen.at(-1)! > 8, `active cars ${a.seen.at(-1)}`);
});

test('a car keeps its distance, and stops at a junction before turning', () => {
  const graph = roadGraph(ROADS);
  const flow = traffic(2, 1, 1500);
  const north = graph.roads.findIndex((road) => road.id === 'north');
  const [lead, follower] = flow.cars;
  Object.assign(lead, { active: true, road: north, s: 300, dir: 1, speed: 0, wait: 99 });
  Object.assign(follower, { active: true, road: north, s: 240, dir: 1, speed: 10 });
  let stopped = false;
  for (let i = 0; i < 20 * 60; i++) {
    lead.speed = 0;
    lead.s = 300;
    stepTraffic(graph, flow, 0, 0, [], STEP);
    stopped ||= follower.speed < 0.1;
  }
  assert.ok(stopped && Math.abs(follower.s - 300) > 6, `follower at ${follower.s}`);
  // On the avenue, a car brakes to the stop line of the junction with the lane and the south
  // street, stands, then turns onto one of them.
  const avenue = graph.roads.findIndex((road) => road.id === 'avenue');
  assert.equal(graph.ends[avenue][1].length, 2);
  flow.cars.pop();
  Object.assign(lead, { road: avenue, s: 400, dir: 1, speed: 14, wait: 0 });
  let stood = 0;
  for (let i = 0; i < 60 * 60 && lead.road === avenue; i++) {
    stepTraffic(graph, flow, 0, 0, [], STEP);
    if (lead.road === avenue && lead.speed < 0.5) stood += STEP;
  }
  assert.notEqual(lead.road, avenue);
  assert.ok(stood > 0.5, `stood ${stood.toFixed(2)} s at the junction`);
});

test('pedestrians walk the pavements of the town near the player and hurry away from a car', () => {
  const world = fixtureWorld();
  const people = crowd(20, 332, 350, world.settlements, world.roads);
  for (let i = 0; i < 60; i++) stepCrowd(people, 0, -300, [], STEP);
  const walking = people.people.filter((p) => p.active);
  assert.ok(walking.length > 10, `${walking.length} out`);
  for (const person of walking) {
    assert.ok(Math.hypot(person.x, person.z + 300) <= 350 + 5);
    const pavement = nearestRoad(people.streets, person.x, person.z)!;
    assert.ok(pavement.distance >= pavement.road.width / 2, 'on the pavement, not the road');
  }
  const target = walking[0];
  const car = { x: target.x - 5, z: target.z, vx: 12, vz: 0 };
  stepCrowd(people, 0, -300, [car], STEP);
  assert.equal(target.gait, 2);
});
