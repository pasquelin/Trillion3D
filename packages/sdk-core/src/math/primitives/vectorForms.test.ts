// #787: the hand copies of add, sub, scale, add-scaled, cross and dot that the kernel's vector forms
// replaced (`lighting/scene/math.ts`, `world/geometry/round.ts`, `physics/soft.ts`,
// `sdk-browser/src/physics/jointFrames.ts`), each written here as it stood, give the same bits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addScaledVector3,
  addVector3,
  copyScaledVector3,
  crossVector3,
  dotVector3,
  subVector3,
} from './vector.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';

type V3 = [number, number, number];
/** The kit's hostile floats, with overflow, finite values and inexact sums. */
const SCALARS = [...HOSTILE_FLOATS, 1, -1, 2.5, 1e308, -1e308, 0.1, 1 / 3];
/** Each scalar in turn on every component, beside its next two. */
const HOSTILE = SCALARS.map(
  (_, i): V3 => [0, 1, 2].map((k) => SCALARS[(i + k) % SCALARS.length]) as V3,
);

const copyAdd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const copyScale = (v: V3, f: number): V3 => [v[0] * f, v[1] * f, v[2] * f];
const copySub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const copyCross = (u: V3, v: V3) => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const copyDot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

test('addVector3 and subVector3 give the bits of the copies they replace, aliased or not', () => {
  for (const a of HOSTILE)
    for (const b of HOSTILE) {
      assertBits(addVector3<V3>([7, 7, 7], a, b), copyAdd(a, b), 'add');
      assertBits(subVector3<V3>([7, 7, 7], a, b), copySub(a, b), 'sub');
      // The lighting copy subtracted as `add(a, scale(b, -1))`: the same bits as `a - b`.
      assertBits(subVector3<V3>([7, 7, 7], a, b), copyAdd(a, copyScale(b, -1)), 'subtract');
      const [intoA, intoB]: V3[] = [[...a], [...b]];
      assertBits(addVector3(intoA, intoA, b), copyAdd(a, b), 'add into a');
      assertBits(subVector3(intoB, a, intoB), copySub(a, b), 'sub into b');
    }
});

test('copyScaledVector3 gives the bits of the lighting copy of scale', () => {
  for (const v of HOSTILE)
    for (const f of SCALARS)
      assertBits(copyScaledVector3<V3>([7, 7, 7], v, f), copyScale(v, f), `${v} · ${f}`);
});

test('crossVector3 in place and dotVector3 give the bits of the soft-body and joint copies', () => {
  for (const u of HOSTILE)
    for (const v of HOSTILE) {
      assertBits(crossVector3([...u], [...u], v), copyCross(u, v), 'cross into u');
      assert.ok(Object.is(dotVector3(u, v), copyDot(u, v)), `${u} · ${v}`);
    }
});

test('addScaledVector3 on a copy gives the bits of the joint and tube copies it replaced', () => {
  for (const a of HOSTILE)
    for (const b of HOSTILE)
      for (const s of SCALARS) {
        // `a - s · b` (jointFrames `squared`, round's carried normal) and `a + s · b` (ring points).
        const minus: V3 = [a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2]];
        const plus: V3 = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
        assertBits(addScaledVector3<V3>([...a], b, -s), minus, `${a} - ${s} · ${b}`);
        assertBits(addScaledVector3<V3>([...a], b, s), plus, `${a} + ${s} · ${b}`);
      }
});
