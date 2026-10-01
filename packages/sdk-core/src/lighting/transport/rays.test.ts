import test from 'node:test';
import assert from 'node:assert/strict';
import type { Patch, Vec3 } from '../scene/experimentScene.ts';
import { createLightingScene } from '../scene/experimentScene.ts';
import { fillPatchRays } from './rays.ts';
import { cross, dot, sub, unit } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

/** Rays of `patches[index]`, each `{ origin, direction }`. */
function rays(patches: Patch[], index: number, count: number) {
  const buffer = new Float64Array(patches.length * count * 6);
  fillPatchRays({ patches } as any, index, count, buffer);
  return Array.from({ length: count }, (_, i) => {
    const at = (index * count + i) * 6;
    return {
      origin: [...buffer.slice(at, at + 3)] as Vec3,
      direction: [...buffer.slice(at + 3, at + 6)] as Vec3,
    };
  });
}
const patch = (id: number, center: Vec3, normal: Vec3, u: Vec3, v: Vec3) =>
  ({
    id,
    surface: 0,
    center,
    normal,
    u,
    v,
    area: 1,
    albedo: [0, 0, 0],
    emission: [0, 0, 0],
  }) as Patch;
/** Fraction of a turn of `direction` around the normal, from the patch's `u` side. */
const azimuth = (p: Patch, direction: Vec3) => {
  const tangent = unit(p.u),
    bitangent = cross(p.normal, tangent);
  const turn = Math.atan2(dot(direction, bitangent), dot(direction, tangent)) / (2 * Math.PI);
  return turn - Math.floor(turn);
};
const scene = createLightingScene({ doorAngle: 0.7, lightIntensity: 1 });

test('every ray is a unit direction into the hemisphere of its patch, leaving from just above it', () => {
  const wrong: number[] = [];
  for (let index = 0; index < scene.patches.length; index++) {
    const p = scene.patches[index];
    for (const { origin, direction } of rays(scene.patches, index, 16)) {
      const lift = dot(sub(origin, p.center), p.normal);
      if (Math.abs(Math.hypot(...direction) - 1) > 1e-12 || !(dot(direction, p.normal) > 0))
        wrong.push(index);
      if (!(lift > 0 && lift < 1e-5)) wrong.push(index);
    }
  }
  assert.deepEqual(wrong, []);
});

test('each direction leaves from four origins, one in each quarter of the patch around its centre', () => {
  for (const p of scene.patches.slice(0, 40)) {
    const all = rays(scene.patches, p.id, 32);
    for (let first = 0; first < all.length; first += 4) {
      const group = all.slice(first, first + 4);
      assert.ok(
        group.every((ray) =>
          ray.direction.every((value, axis) => value === group[0].direction[axis]),
        ),
      );
      const quarters = new Set<string>(),
        mean = [0, 0];
      for (const { origin } of group) {
        const offset = sub(origin, p.center);
        const a = dot(offset, p.u) / dot(p.u, p.u),
          b = dot(offset, p.v) / dot(p.v, p.v);
        assert.ok(Math.abs(a) < 0.5 && Math.abs(b) < 0.5 && a !== 0 && b !== 0);
        quarters.add(`${Math.sign(a)} ${Math.sign(b)}`);
        mean[0] += a / 4;
        mean[1] += b / 4;
      }
      assert.equal(quarters.size, 4);
      assert.ok(Math.abs(mean[0]) < 1e-12 && Math.abs(mean[1]) < 1e-12);
    }
  }
});

test('directions are cosine-weighted: each equal-area ring of the projected disc holds one', () => {
  const p = scene.patches[5];
  for (const count of [4, 16, 64, 256]) {
    const directions = rays(scene.patches, p.id, count).filter((_, i) => i % 4 === 0);
    const rings = directions
      .map(({ direction }) => Math.floor((1 - dot(direction, p.normal) ** 2) * directions.length))
      .sort((a, b) => a - b);
    assert.deepEqual(
      rings,
      directions.map((_, ring) => ring),
      `${count}`,
    );
  }
});

test('a power-of-two count of directions turns around the normal in even steps', () => {
  for (const p of scene.patches.slice(0, 20))
    for (const count of [8, 16, 64, 256]) {
      const turns = rays(scene.patches, p.id, count)
        .filter((_, i) => i % 4 === 0)
        .map(({ direction }) => azimuth(p, direction))
        .sort((a, b) => a - b);
      const step = 1 / turns.length;
      turns.forEach((turn, i) => {
        const gap = i ? turn - turns[i - 1] : turn + 1 - turns.at(-1)!;
        assert.ok(Math.abs(gap - step) < 1e-9, `${p.id} ${count} ${gap}`);
      });
    }
});

/** The base-2 van der Corput point of `k`: its binary digits mirrored behind the point. */
const vanDerCorput = (k: number) => {
  const digits = k.toString(2);
  return parseInt([...digits].reverse().join(''), 2) / 2 ** digits.length;
};
/** The golden ratio's conjugate, the turn between the sequences of consecutive patches. */
const GOLDEN = (Math.sqrt(5) - 1) / 2;
const circular = (a: number, b: number) => Math.abs(((a - b + 1.5) % 1) - 0.5);

test('direction k of patch p turns from the tangent towards the bitangent by vdc(k) + p·golden', () => {
  const twins = Array.from({ length: 40 }, (_, id) =>
    patch(id, [1, 2, 3], unit([1, 2, 2]), [2, -1, 0], cross(unit([1, 2, 2]), [2, -1, 0])),
  );
  for (const p of twins)
    rays(twins, p.id, 64)
      .filter((_, i) => i % 4 === 0)
      .forEach(({ direction }, k) => {
        const expected = (vanDerCorput(k) + p.id * GOLDEN) % 1;
        assert.ok(circular(azimuth(p, direction), expected) < 1e-9, `${p.id} ${k}`);
      });
});

test('patches at one place sample the same directions only when they share their number', () => {
  const twins = Array.from({ length: 24 }, (_, id) =>
    patch(id, [3, 5, 7], [0, 0, 1], [2, 0, 0], [0, 4, 0]),
  );
  const first = (index: number) => azimuth(twins[index], rays(twins, index, 16)[0].direction);
  const turns = twins.map((_, index) => first(index));
  for (let a = 0; a < turns.length; a++)
    for (let b = a + 1; b < turns.length; b++)
      assert.ok(Math.abs(turns[a] - turns[b]) > 1e-6, `${a} ${b}`);
  assert.deepEqual(rays(twins, 3, 16), rays(twins, 3, 16));
});

test('turning a patch turns every origin and direction of its rays with it', () => {
  const base = patch(3, [3, 5, 7], [0, 0, 1], [2, 0, 0], [0, 4, 0]);
  const reference = rays([base], 0, 64);
  for (const turn of [
    ([x, y, z]: Vec3): Vec3 => [z, x, y],
    ([x, y, z]: Vec3): Vec3 => [x, -z, y],
    ([x, y, z]: Vec3): Vec3 => [-y, x, z],
  ]) {
    const turned = patch(3, turn(base.center), turn(base.normal), turn(base.u), turn(base.v));
    rays([turned], 0, 64).forEach((ray, i) => {
      for (const key of ['origin', 'direction'] as const) {
        const expected = turn(reference[i][key]);
        ray[key].forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-12));
      }
    });
  }
});

test('a patch writes only its own range of the ray buffer', () => {
  const patches = scene.patches.slice(0, 3);
  const buffer = new Float64Array(3 * 8 * 6).fill(99);
  fillPatchRays({ patches } as any, 1, 8, buffer);
  assert.ok(buffer.slice(0, 48).every((value) => value === 99));
  assert.ok(buffer.slice(96).every((value) => value === 99));
  assert.ok(buffer.slice(48, 96).every((value) => value !== 99));
});

test('a patch without a tangent is refused', () => {
  const flat = patch(0, [0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 1, 0]);
  assert.throws(
    () => fillPatchRays({ patches: [flat] } as any, 0, 4, new Float64Array(24)),
    (error: any) => error.code === 'INVALID_SCENE' && /tangent/.test(error.message),
  );
});
