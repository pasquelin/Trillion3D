import { angleBetween, between, turnBetween, type Client } from './client.ts';
import { axisAngle, headingOf, rotate, type Q } from './math3.ts';
import type { Moving } from './movers.ts';
import { builder, type Built } from './models.ts';
import { BLOCK, H, spawnsOf, type Layout, type SimLimits } from './protocol.ts';
import type { Engine, Marker, ModelSpec, Node3, SpotNode } from './types.ts';
import { figures, stride } from './walkers.ts';

/**
 * Everything the simulation moves, as scene objects: the player's car and plane, the vehicles
 * parked at the spawns, the traffic, the pedestrians and the movers. Built once; every frame
 * writes their transforms between the last two snapshots.
 * Waiting on the engine: hand-built meshes moved every frame beside a compiled cache.
 */
export type View = {
  update(c: Client, t: number, delta: number): void;
  /** Lamps on (headlights, beacons) or off. */
  night(on: boolean): void;
  /** Model names asked for by a mover that no model answers; those movers are not drawn. */
  missing: string[];
};

const HEADLIGHT = 400;

function pose(node: Node3, position: readonly number[], turn: readonly number[]) {
  node.position.set(position[0], position[1], position[2]);
  node.quaternion.set(turn[0], turn[1], turn[2], turn[3]);
}

/** A spawn's parked vehicle, standing where the marker says, the way it faces. */
function parked(built: Built, marker: Extract<Marker, { kind: 'spawn' }>, lift: number) {
  pose(
    built.root,
    [marker.position[0], marker.position[1] + lift, marker.position[2]],
    axisAngle([0, 1, 0], marker.yaw),
  );
  return built;
}

export function view(
  engine: Engine,
  scene: Node3,
  models: Readonly<Record<string, ModelSpec>>,
  layout: Layout,
  limits: SimLimits,
  moving: readonly Moving[],
  markers: readonly Marker[],
): View {
  const build = builder(engine);
  const [carSpec, planeSpec] = [models.car, models.plane];
  const car = build(carSpec, { lamps: true });
  const plane = build(planeSpec);
  const parkedCars = spawnsOf(markers, 'car').map((m) => parked(build(carSpec), m, 0.9));
  const parkedPlanes = spawnsOf(markers, 'plane').map((m) => parked(build(planeSpec), m, 1.6));
  const traffic = Array.from({ length: limits.traffic }, () => build(models.traffic ?? carSpec));
  const people = figures(engine, limits.pedestrians);
  const missing: string[] = [];
  const beams: SpotNode[] = [];
  const movers = moving.map(({ mover }) => {
    if (mover.kind === 'beacon') {
      // Two beams back to back, sweeping as the group turns.
      const root = engine.object.group();
      for (const side of [-1, 1]) {
        const beam = engine.light.spot({
          color: [1, 0.95, 0.85],
          intensity: 0,
          distance: mover.range,
          angle: 0.08,
          penumbra: 0.3,
          position: [0, 0, 0],
        });
        beam.target.position.set(0, 0, side * mover.range);
        root.add(beam, beam.target);
        beams.push(beam);
      }
      return { root, spec: null };
    }
    const spec = models[mover.model];
    if (!spec) {
      if (!missing.includes(mover.model)) missing.push(mover.model);
      return null;
    }
    return { root: build(spec).root, spec };
  });
  for (const built of [car, plane, ...parkedCars, ...parkedPlanes, ...traffic, ...people])
    scene.add(built.root);
  for (const mover of movers) if (mover) scene.add(mover.root);
  car.root.visible = plane.root.visible = false;
  let spin = 0;
  const wheelsOf = (built: Built, c: Client, at: number, t: number) =>
    built.wheels.forEach((wheel, i) =>
      pose(
        wheel,
        [0, 1, 2].map((k) => c.next[at + 7 + i * 7 + k]),
        turnBetween(c, at + 10 + i * 7, t),
      ),
    );
  return {
    missing,
    night(on) {
      for (const lamp of car.lamps) lamp.intensity = on ? HEADLIGHT : 0;
      for (const beam of beams) beam.intensity = on ? HEADLIGHT * 20 : 0;
    },
    update(c, t, delta) {
      const { next } = c;
      const [carSpawn, planeSpawn] = [next[H.carSpawn], next[H.planeSpawn]];
      parkedCars.forEach((built, i) => (built.root.visible = i !== carSpawn));
      parkedPlanes.forEach((built, i) => (built.root.visible = i !== planeSpawn));
      car.root.visible = carSpawn >= 0;
      if (car.root.visible) {
        pose(car.root, between(c, layout.car, t), turnBetween(c, layout.car + 3, t));
        wheelsOf(car, c, layout.car, t);
      }
      plane.root.visible = planeSpawn >= 0;
      if (plane.root.visible)
        pose(plane.root, between(c, layout.plane, t), turnBetween(c, layout.plane + 3, t));
      spin += next[H.propeller] * 40 * delta + (planeSpawn >= 0 ? 2 * delta : 0);
      plane.propeller?.quaternion.set(...axisAngle([0, 0, 1], spin));
      traffic.forEach((built, i) => {
        const at = layout.traffic + i * BLOCK.traffic;
        built.root.visible = next[at + 4] >= 0;
        if (!built.root.visible) return;
        const blend = c.prev[at + 4] >= 0 ? t : 1;
        pose(
          built.root,
          between(c, at, blend),
          axisAngle([0, 1, 0], angleBetween(c, at + 3, blend)),
        );
      });
      people.forEach((figure, i) => {
        const at = layout.pedestrians + i * BLOCK.pedestrian;
        figure.root.visible = next[at + 5] >= 0;
        if (!figure.root.visible) return;
        const blend = c.prev[at + 5] >= 0 ? t : 1;
        figure.root.position.set(...between(c, at, blend));
        stride(figure, angleBetween(c, at + 3, blend), next[at + 4], next[at + 5]);
      });
      movers.forEach((built, i) => {
        if (!built) return;
        const at = layout.movers + i * BLOCK.mover;
        let turn: Q = turnBetween(c, at + 3, t);
        // What does not follow the path's slope stays upright, facing along it.
        if (built.spec && built.spec.follow !== 'path' && moving[i].mover.kind === 'path') {
          const forward = rotate(turn, [0, 0, -1]);
          turn = axisAngle([0, 1, 0], headingOf(forward[0], forward[2]));
        }
        pose(built.root, between(c, at, t), turn);
      });
    },
  };
}
