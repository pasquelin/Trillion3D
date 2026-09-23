import { axisAngle, clamp, fromTo, headingOf, multiply, yawPitchRoll, type Q } from './math3.ts';
import { polyline, travel, type Polyline } from './roads.ts';
import type { Mover, Road, Vec3 } from './types.ts';

/**
 * What moves on its own, as a function of time: boats and cable cars along their paths, rotors
 * spinning, beacons sweeping, and aircraft flying touch-and-go circuits over every runway. Both
 * the page (to build one object per mover) and the worker (to pose them) read this same list.
 */
export type Moving = { mover: Mover; line: Polyline | null };

/** Circuit height and leg lengths of a runway's traffic pattern, metres; speed m/s. */
const CIRCUIT = { height: 300, upwind: 3000, spacing: 3000, speed: 70 } as const;

/**
 * A touch-and-go circuit over a runway: roll and lift off along it, climb out, turn across,
 * fly back downwind, turn onto final and touch down at the threshold where the loop starts again.
 */
function circuit(runway: Road): Mover {
  const a = runway.points[0];
  const b = runway.points[runway.points.length - 1];
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const [ux, uz] = [(b[0] - a[0]) / length, (b[2] - a[2]) / length];
  const [rx, rz] = [-uz, ux];
  const at = (along: number, side: number, height: number): Vec3 => [
    a[0] + ux * along + rx * side,
    a[1] + height,
    a[2] + uz * along + rz * side,
  ];
  const { height, upwind, spacing } = CIRCUIT;
  return {
    kind: 'path',
    name: `circuit ${runway.id}`,
    model: 'plane',
    points: [
      at(0, 0, 0),
      at(length * 0.55, 0, 0),
      at(length + upwind * 0.5, 0, height * 0.5),
      at(length + upwind, 0, height),
      at(length + upwind, spacing, height),
      at(-upwind, spacing, height),
      at(-upwind, 0, height * 0.6),
      at(-upwind * 0.4, 0, height * 0.25),
      at(0, 0, 0),
    ],
    speed: CIRCUIT.speed,
    loop: true,
  };
}

/** Every mover of the world: the regions' own, then one circuit per runway. */
export function movingWorld(movers: readonly Mover[], roads: readonly Road[]): Moving[] {
  const all = [...movers, ...roads.filter((road) => road.class === 'runway').map(circuit)];
  return all.map((mover) => ({
    mover,
    line: mover.kind === 'path' ? polyline(mover.points) : null,
  }));
}

/** The pose of a mover at `time` seconds: position, then quaternion, into `out` at `at`. */
export function posed(
  moving: Moving,
  time: number,
  out: Float32Array | number[],
  at: number,
  originX = 0,
  originZ = 0,
) {
  const { mover, line } = moving;
  let position: readonly number[];
  let turn: Q;
  if (mover.kind === 'path' && line) {
    const sample = travel(line, mover.speed * time, mover.loop);
    const [dx, dy, dz] = sample.direction;
    position = sample.position;
    turn = yawPitchRoll(headingOf(dx, dz), Math.asin(clamp(dy, -1, 1)));
  } else if (mover.kind === 'spin') {
    position = mover.position;
    // The model turns about its own +Z, laid along the mover's axis.
    const length = Math.hypot(...mover.axis) || 1;
    const axis = mover.axis.map((v) => v / length);
    turn = multiply(
      fromTo([0, 0, 1], axis),
      axisAngle([0, 0, 1], (mover.rpm / 60) * 2 * Math.PI * time),
    );
  } else if (mover.kind === 'beacon') {
    position = mover.position;
    turn = axisAngle([0, 1, 0], (mover.rpm / 60) * 2 * Math.PI * time);
  } else return;
  out[at] = position[0] - originX;
  out[at + 1] = position[1];
  out[at + 2] = position[2] - originZ;
  for (let i = 0; i < 4; i++) out[at + 3 + i] = turn[i];
}
