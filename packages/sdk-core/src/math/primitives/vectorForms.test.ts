// #787: the out-parameter add and sub that replaced the hand copies in lighting, round geometry,
// joints and `Vector3.addVectors` / `subVectors`, written as they stood: same bits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addVector3, subVector3 } from './vector.ts';
import { Vector3 } from '../../world/math/vector3.ts';
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
const copySub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** The lighting copy of `subtract`: `add(a, scale(b, -1))`. */
const copySubtract = (a: V3, b: V3): V3 => copyAdd(a, [b[0] * -1, b[1] * -1, b[2] * -1]);

test('addVector3 and subVector3 give the bits of the copies they replace, aliased or not', () => {
  for (const a of HOSTILE)
    for (const b of HOSTILE) {
      assertBits(addVector3<V3>([7, 7, 7], a, b), copyAdd(a, b), 'add');
      assertBits(subVector3<V3>([7, 7, 7], a, b), copySub(a, b), 'sub');
      assertBits(subVector3<V3>([7, 7, 7], a, b), copySubtract(a, b), 'subtract');
      const [intoA, intoB]: V3[] = [[...a], [...b]];
      assertBits(addVector3(intoA, intoA, b), copyAdd(a, b), 'add into a');
      assertBits(subVector3(intoB, a, intoB), copySub(a, b), 'sub into b');
    }
});

/** `Vector3`'s two methods as they stood, on its unchanged `set`, `copy` and `addScaledVector`. */
const before = {
  addVectors: (t: Vector3, u: Vector3, v: Vector3) => t.set(u.x + v.x, u.y + v.y, u.z + v.z),
  subVectors: (t: Vector3, u: Vector3, v: Vector3) => t.copy(u).addScaledVector(v, -1),
};

test('Vector3.addVectors and subVectors keep their bits, their writes heard and their return', () => {
  for (const method of ['addVectors', 'subVectors'] as const)
    for (const start of [[0, 0, 0], [7, 7, 7], ...HOSTILE])
      for (const a of HOSTILE)
        for (const b of HOSTILE)
          for (const alias of ['none', 'u', 'v'] as const) {
            const [now, was] = [new Vector3(...start), new Vector3(...start)];
            const heard = [0, 0];
            now._onChange = () => heard[0]++;
            was._onChange = () => heard[1]++;
            const pick = (t: Vector3, own: V3, as: typeof alias) =>
              alias === as ? t : new Vector3(...own);
            const back = now[method](pick(now, a, 'u'), pick(now, b, 'v'));
            before[method](was, pick(was, a, 'u'), pick(was, b, 'v'));
            assertBits(now.elements, was.elements, `${method} ${start} ${a} ${b} ${alias}`);
            assert.equal(heard[0], heard[1], `${method} writes heard`);
            assert.equal(back, now);
          }
});
