import test from 'node:test';
import assert from 'node:assert/strict';
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import { CommandWriter, SHAPE } from '../../../sdk-core/src/physics/index.ts';
import type { BodyRecord } from '../../../sdk-core/src/physics/bodyRecord.ts';
import { startModule } from './module.fixture.ts';
import { floater, runWater } from './water.fixture.ts';

const G = 9.81,
  DT = 1 / 60,
  MASS = 1000,
  WATER = 1000;
/** Level water at 0 under one wave of no height a metre long: every body longer than half a
 *  metre is cut into slices, each with its own plane. */
const RIPPLE: WaterSpec = {
  waves: [{ direction: [1, 0], wavelength: 1, amplitude: 1e-9, steepness: 0 }],
  level: 0,
  density: WATER,
};

/**
 * A body of `MASS` kg at rest at `position` turned by `quaternion`, after one step in `RIPPLE`:
 * the volume the water measured under it, from the speed it gained (`(ρ V / m − 1) g dt`: at rest
 * no drag), and its spin.
 */
async function measured(
  shape: Pick<BodyRecord, 'shape' | 'size'>,
  position: number[],
  quaternion = [0, 0, 0, 1],
) {
  const writer = new CommandWriter();
  writer.gravity([0, -G, 0]);
  writer.add({ ...floater(0, position, 0, shape), quaternion, mass: MASS, damping: [0, 0] });
  const { last } = runWater(await startModule(), RIPPLE, writer.take(), 1);
  const pose = new Float32Array(new Uint32Array(last.get(0)!).buffer);
  return { volume: ((pose[9] / (G * DT) + 1) * MASS) / WATER, spin: pose.slice(11, 14) };
}

const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} m³, not ${expected}`);

/** The volume of a ball of radius `r` under water `depth` below its top (a spherical cap). */
const cap = (r: number, depth: number) => (Math.PI * depth * depth * (3 * r - depth)) / 3;

test('a ball wider than the slices floats on its exact cap, never on whole balls side by side', async () => {
  const ball = { shape: SHAPE.sphere, size: [1, 0, 0] as const };
  for (const [y, depth] of [
    [1.2, 0],
    [0.75, 0.25],
    [0.5, 0.5],
    [-0.5, 1.5],
  ])
    near((await measured(ball, [0, y, 0])).volume, cap(1, depth), 2e-4, `centre at ${y}`);
});

test('a log floats on its exact segment, and the water never rolls it about its own axis', async () => {
  // A cylinder of radius 0.5 and length 4 lying along x, 0.3 m of it under water.
  const log = { shape: SHAPE.cylinder, size: [2, 0.5, 0] as const };
  const theta = 2 * Math.acos((0.5 - 0.3) / 0.5);
  const segment = (0.25 * (theta - Math.sin(theta))) / 2;
  for (const roll of [0, 0.2, 0.4]) {
    // Laid along x (a quarter turn about z), then rolled about x.
    const [s, c, h] = [Math.sin(roll / 2), Math.cos(roll / 2), Math.SQRT1_2];
    const quaternion = [s * h, -s * h, c * h, c * h];
    const { volume, spin } = await measured(log, [0, 0.2, 0], quaternion);
    near(volume, 4 * segment, 2e-4, `rolled ${roll}`);
    assert.ok(Math.abs(spin[0]) < 1e-5, `rolled ${roll}, it turns at ${spin[0]} rad/s`);
  }
});

test('a cone and a capsule float on their exact volumes, not on their boxes', async () => {
  // Half height 1, top radius 0.05, bottom radius 1: the water at mid-height wets the frustum
  // below it, π (r² d + r s d² + s² d³ / 3) with s = −0.475 per metre and d = 1.
  const cone = { shape: SHAPE.cylinder, size: [1, 0.05, 1] as const };
  const frustum = Math.PI * (1 - 0.475 + 0.475 ** 2 / 3);
  near((await measured(cone, [0, 0, 0])).volume, frustum, 2e-4, 'the cone');
  // Half height 1, radius 0.3, upright, the water 0.5 below its middle: a hemisphere and half a
  // metre of its side.
  const capsule = { shape: SHAPE.capsule, size: [1, 0.3, 0] as const };
  const wet = (2 / 3) * Math.PI * 0.3 ** 3 + Math.PI * 0.09 * 0.5;
  near((await measured(capsule, [0, 0.5, 0])).volume, wet, 2e-4, 'the capsule');
});
