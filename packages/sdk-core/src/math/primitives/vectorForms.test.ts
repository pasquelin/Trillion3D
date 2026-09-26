// #787: the out-parameter add and sub that replaced the hand copies in lighting, round geometry
// and joints, written as they stood: same bits.
import test from 'node:test';
import { addVector3, subVector3 } from './vector.ts';
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
