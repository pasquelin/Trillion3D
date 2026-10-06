// Parent/child rules of the math kernel, on chains of every depth with mirrored, non-uniform and
// zero scales and rotated parents (a non-uniform scale under a rotation shears the world matrix).
// Each node's world matrix is its parent's times its own composed local matrix; the rules checked
// on it are stated outright and do not lean on a second implementation: a point goes through the
// scale, the turn and the shift of every ancestor, the determinant is the product of the scales,
// the inverse undoes the world matrix, the normal matrix is its inverse transpose. The comparison
// against a host library lives in the bench (`bench/perf/browser/support/coreEquivalence.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMatrix4, decomposeMatrix4 } from './matrix4Trs.ts';
import { determinantMatrix4, multiplyMatrix4 } from './matrix4.ts';
import { invertMatrix4 } from './matrix4Inverse.ts';
import { normalMatrix3 } from './matrix3.ts';

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
interface Level {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

const half = Math.SQRT1_2;
const POSITIONS: Vec3[] = [
  [0, 0, 0],
  [1, -2, 3],
  [-40, 15, 0.5],
  [1000, 2000, -3000],
];
const ROTATIONS: Quat[] = [
  [0, 0, 0, 1],
  [0, 0, half, half],
  [half, 0, 0, half],
  [0.5, 0.5, 0.5, 0.5],
  [0.2, -0.4, 0.1, Math.sqrt(1 - 0.04 - 0.16 - 0.01)],
];
const SCALES: Vec3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [-1, 1, 1],
  [1, -3, 1],
  [-2, -2, 1],
  [-1, -1, -1],
  [3, 0.25, 1],
  [0, 1, 1],
];

/** Chains of depth 1 to 6, each level drawn from the lists above. */
function chains(): Level[][] {
  const out: Level[][] = [];
  for (let k = 0; k < 60; k++) {
    const chain: Level[] = [];
    for (let level = 0; level <= k % 6; level++)
      chain.push({
        position: POSITIONS[(k + level) % POSITIONS.length],
        rotation: ROTATIONS[(k * 3 + level) % ROTATIONS.length],
        scale: SCALES[(k * 7 + level * 5) % SCALES.length],
      });
    out.push(chain);
  }
  return out;
}

const worldOf = (chain: Level[]) => {
  let world = new Float64Array(16);
  composeMatrix4(world, chain[0].position, chain[0].rotation, chain[0].scale);
  for (const level of chain.slice(1)) {
    const local = new Float64Array(16);
    composeMatrix4(local, level.position, level.rotation, level.scale);
    world = multiplyMatrix4(new Float64Array(16), world, local);
  }
  return world;
};

/** `q p q*` for a unit quaternion. */
function turn(q: Quat, p: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * p[2] - z * p[1]),
    ty = 2 * (z * p[0] - x * p[2]),
    tz = 2 * (x * p[1] - y * p[0]);
  return [
    p[0] + w * tx + (y * tz - z * ty),
    p[1] + w * ty + (z * tx - x * tz),
    p[2] + w * tz + (x * ty - y * tx),
  ];
}
/** The point through each level, innermost first: scale, turn, shift. */
function throughChain(chain: Level[], point: Vec3): Vec3 {
  let p = point;
  for (let i = chain.length - 1; i >= 0; i--) {
    const { scale, rotation, position } = chain[i];
    const r = turn(rotation, [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]]);
    p = [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
  }
  return p;
}
const apply = (m: Float64Array, p: Vec3): Vec3 =>
  [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]) as Vec3;
const collapsed = (chain: Level[]) => chain.some((l) => l.scale.some((c) => c === 0));
const close = (a: number, b: number, rel = 1e-9) =>
  Math.abs(a - b) <= rel * (1 + Math.abs(a) + Math.abs(b));

test('the chains cover depth, mirrored axes, zero scale and a non-uniform scale under a rotated parent', () => {
  const all = chains();
  assert.ok(Math.max(...all.map((c) => c.length)) >= 6);
  const levels = all.flat();
  assert.ok(
    levels.some((l) => l.scale.filter((c) => c < 0).length === 1),
    'one negative axis',
  );
  assert.ok(
    levels.some((l) => l.scale.some((c) => c === 0)),
    'zero scale',
  );
  assert.ok(
    all.some((c) =>
      c.some((l, i) => i > 0 && c[i - 1].rotation[3] !== 1 && new Set(l.scale).size > 1),
    ),
    'non-uniform scale under a rotation',
  );
});

test('a point of a node goes through the scale, the turn and the shift of every ancestor', () => {
  for (const [index, chain] of chains().entries()) {
    const world = worldOf(chain);
    for (const p of [
      [1, 2, 3],
      [-0.5, 4, 0.25],
    ] as Vec3[]) {
      const want = throughChain(chain, p),
        got = apply(world, p);
      for (let i = 0; i < 3; i++)
        assert.ok(close(got[i], want[i]), `chain ${index}, axis ${i}: ${got[i]} vs ${want[i]}`);
    }
  }
});

test('the determinant of a world matrix is the product of the scale triple products down the chain; its sign says the face winding', () => {
  for (const [index, chain] of chains().entries()) {
    const want = chain.reduce((d, l) => d * l.scale[0] * l.scale[1] * l.scale[2], 1);
    const got = determinantMatrix4(worldOf(chain));
    assert.ok(close(got, want), `chain ${index}: ${got} vs ${want}`);
    if (want !== 0) assert.equal(Math.sign(got), Math.sign(want));
  }
});

test('the inverse undoes the world matrix', () => {
  for (const [index, chain] of chains().entries()) {
    if (collapsed(chain)) continue;
    const world = worldOf(chain),
      inverse = invertMatrix4(new Float64Array(16), world);
    const identity = multiplyMatrix4(new Float64Array(16), world, inverse);
    for (let i = 0; i < 16; i++)
      assert.ok(
        Math.abs(identity[i] - (i % 5 === 0 ? 1 : 0)) < 1e-6,
        `chain ${index}[${i}]: ${identity[i]}`,
      );
  }
});

test('the normal matrix is the inverse transpose of the linear part: its transpose times the linear part is the identity', () => {
  for (const [index, chain] of chains().entries()) {
    const world = worldOf(chain);
    if (collapsed(chain)) continue;
    const n = normalMatrix3(new Float64Array(9), world);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += n[3 * r + k] * world[4 * c + k];
        assert.ok(Math.abs(sum - (r === c ? 1 : 0)) < 1e-6, `chain ${index}[${r}][${c}]: ${sum}`);
      }
  }
});

test('decomposition: the position is the translation column, the scale magnitudes are the column lengths, a mirrored world carries its sign on x', () => {
  for (const [index, chain] of chains().entries()) {
    const world = worldOf(chain);
    if (collapsed(chain)) continue;
    const p = new Float64Array(3),
      q = new Float64Array(4),
      s = new Float64Array(3);
    decomposeMatrix4(world, p, q, s);
    assert.deepEqual([...p], [world[12], world[13], world[14]], `chain ${index} position`);
    for (let c = 0; c < 3; c++)
      assert.ok(
        close(Math.abs(s[c]), Math.hypot(world[4 * c], world[4 * c + 1], world[4 * c + 2])),
        `chain ${index} scale ${c}`,
      );
    assert.equal(s[0] < 0, determinantMatrix4(world) < 0, `chain ${index} sign`);
  }
});
