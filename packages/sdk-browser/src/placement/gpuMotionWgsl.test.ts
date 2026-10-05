// The motion the GPU writes for a linked placement (`gpuMotionWgsl.ts`) is the CPU motion module's
// (`../taa/motion.ts`), word for word: its single-precision worlds widened exactly, the inverse and
// product summed in the CPU's order, the one reciprocal rounded once, the eye brought in double.
// Generated hierarchies: rotations, uneven and negative scales, shears, translations and eyes far
// from the origin, parents that move by their last bits only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';
import { multiplyMatrix4 } from '../../../sdk-core/src/index.ts';
import { COMPOSE_ROOTS_WGSL } from './gpuComposeWgsl.ts';
import { createPlacementMotion } from '../taa/motion.ts';
import { fakeDevice, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  generated,
  pair,
  type Pair,
} from './composeDoubles.fixture.ts';

const motionRun = shaderRun<{
  fromF32(w: number): Pair;
  sameWord(a: number, b: number): boolean;
  motionWords(previous: number[], current: number[], eye: Pair[]): number[];
}>(
  COMPOSE_ROOTS_WGSL,
  [...DOUBLE_HELPERS, 'dDiv', 'toF32', 'fromF32', 'sameWord', 'inverse4', 'motionWords'],
  { countLeadingZeros },
);

const wordsOf = (values: ArrayLike<number>) => [
  ...new Uint32Array(Float32Array.from(values).buffer),
];

test('a single-precision word widens to its double exactly, subnormals and specials included', () => {
  const next = random(5);
  const words = [0, 0x80000000, 1, 0x80000001, 0x7fffff, 0x800000, 0x7f7fffff, 0x7f800000];
  words.push(0xff800000, 0x3f800000, 0x00400000, 0x00000003);
  for (let i = 0; i < 4000; i++) words.push(Math.floor(next() * 2 ** 32));
  const cell32 = new Uint32Array(1),
    value = new Float32Array(cell32.buffer);
  for (const w of words) {
    cell32[0] = w;
    const expected = value[0] !== value[0] ? [0xffffffff, 0xffffffff] : pair(value[0]);
    assert.deepEqual(
      motionRun.fromF32(w).map((x) => x >>> 0),
      expected,
      `word ${w}`,
    );
  }
});

test('two words are the same pose as the CPU compares numbers: either zero, never a NaN', () => {
  assert.equal(motionRun.sameWord(0, 0x80000000), true);
  assert.equal(motionRun.sameWord(0x3f800000, 0x3f800000), true);
  assert.equal(motionRun.sameWord(0x7f800000, 0x7f800000), true);
  assert.equal(motionRun.sameWord(0x7fc00000, 0x7fc00000), false);
  assert.equal(motionRun.sameWord(0x3f800000, 0x3f800001), false);
});

/** The CPU motion module (`../taa/motion.ts`) for one root, its buffer read back as words. */
function cpuMotion(previous: Float32Array, current: Float32Array, eye: number[]) {
  const elements = new Float32Array(previous);
  const { device, writes } = fakeDevice();
  const motion = createPlacementMotion(device, [{ world: { elements } }]);
  elements.set(current);
  motion.update(eye, true);
  return { words: wordsOf(written(writes.at(-1)!).subarray(0, 16)), moved: motion.moved };
}

test("a linked root's motion is the CPU motion module's, word for word, near and far, turned, scaled and sheared", () => {
  const next = random(23);
  const product = new Float64Array(16);
  for (let i = 0; i < 300; i++) {
    const far = [10, 1e4, 1e7][i % 3];
    const local = generated(next, 20),
      grand = generated(next, far);
    const parents = [0, 1].map(() => {
      const parent = new Float64Array(16);
      multiplyMatrix4(parent, grand, generated(next, far));
      return parent;
    });
    // Now and then the parent only turns a little, or only slides: the last bits move alone.
    if (i % 5 === 1) for (let k = 0; k < 12; k++) parents[1][k] = parents[0][k] * (1 + 1e-7);
    if (i % 5 === 2) parents[1].set(parents[0].subarray(0, 12));
    const rows = parents.map((parent) => {
      multiplyMatrix4(product, parent, local);
      return Float32Array.from(product);
    });
    const eye = [0, 1, 2].map(() => (next() - 0.5) * far);
    const cpu = cpuMotion(rows[0], rows[1], eye);
    const previous = wordsOf(rows[0]),
      current = wordsOf(rows[1]);
    const same = previous.every((w, k) => motionRun.sameWord(w, current[k]));
    assert.equal(same, !cpu.moved, `case ${i}: moved as the CPU says`);
    if (same) continue;
    const gpu = motionRun.motionWords(previous, current, eye.map(pair)).map((w) => w >>> 0);
    assert.deepEqual(gpu, cpu.words, `case ${i}`);
  }
});

test('a singular world inverts to zero, and its motion is the CPU one too', () => {
  const previous = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5e6, -3, 7, 1]),
    current = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4e6, -3, 7, 1]);
  const eye = [4e6, 1, -2];
  const cpu = cpuMotion(previous, current, eye);
  const gpu = motionRun.motionWords(wordsOf(previous), wordsOf(current), eye.map(pair));
  assert.deepEqual(
    gpu.map((w) => w >>> 0),
    cpu.words,
  );
});
