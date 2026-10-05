import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { DOUBLE_WGSL } from './doubleWgsl.ts';

type Pair = number[];
type Run = {
  dAdd(a: Pair, b: Pair): Pair;
  dSub(a: Pair, b: Pair): Pair;
  dMul(a: Pair, b: Pair): Pair;
  dDiv(a: Pair, b: Pair): Pair;
};

const HELPERS = [
  'dNan',
  'dExponent',
  'dIsNan',
  'dIsZero',
  'dSignificand',
  'dScale',
  'wideAdd',
  'wideSub',
  'wideLeadingZeros',
  'wideShiftLeft',
  'wideShiftRight',
  'wideProduct',
  'dRound',
];
const run = shaderRun<Run>(DOUBLE_WGSL, [...HELPERS, 'dAdd', 'dSub', 'dMul', 'dDiv'], {
  countLeadingZeros: (x: number) => Math.clz32(x),
});

const cell = new Float64Array(1),
  bits = new Uint32Array(cell.buffer);
/** A double's bits as the shader holds them: high word, low word. */
const toPair = (x: number): Pair => ((cell[0] = x), [bits[1], bits[0]]);
const fromPair = ([high, low]: Pair) => ((bits[1] = high), (bits[0] = low), cell[0]);
/** What the CPU computes, as the GPU must answer it: a NaN as the one all-ones pattern. */
const expected = (x: number): Pair => (x !== x ? [0xffffffff, 0xffffffff] : toPair(x));

const EDGES = [
  0,
  -0,
  5e-324,
  -5e-324,
  2.2250738585072009e-308,
  2.2250738585072014e-308,
  1e-310,
  1,
  -1,
  1 + 2 ** -52,
  1 - 2 ** -53,
  2 ** 53,
  2 ** 53 + 2,
  3,
  0.5,
  0.1,
  1e15,
  -1e15,
  1.7976931348623157e308,
  -1.7976931348623157e308,
  1e154,
  1e-154,
  Infinity,
  -Infinity,
  NaN,
];

/** Random doubles over every exponent, and near neighbours of one another for cancellation. */
function values(seed: number, count: number) {
  const next = random(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const roll = next();
    if (roll < 0.4) {
      bits[1] = Math.floor(next() * 2 ** 32);
      bits[0] = Math.floor(next() * 2 ** 32);
      out.push(cell[0]);
    } else if (roll < 0.8) out.push((next() - 0.5) * 10 ** Math.floor(next() * 12 - 4));
    else out.push(Math.round((next() - 0.5) * 2000) / 8);
  }
  return out;
}

type Operation = 'dAdd' | 'dSub' | 'dMul' | 'dDiv';
const OPERATIONS = ['dAdd', 'dSub', 'dMul', 'dDiv'] as const;
const cpuOf = (name: Operation, a: number, b: number) =>
  name === 'dAdd' ? a + b : name === 'dSub' ? a - b : name === 'dMul' ? a * b : a / b;

function check(name: Operation, a: number, b: number) {
  const cpu = cpuOf(name, a, b);
  const gpu = run[name](toPair(a), toPair(b));
  assert.deepEqual(
    gpu.map((word) => word >>> 0),
    expected(cpu),
    `${name}(${a}, ${b}) = ${cpu}, the shader gave ${fromPair(gpu)}`,
  );
}

test('sums, differences, products and quotients of the edge values are the CPU doubles, bit for bit', () => {
  for (const a of EDGES) for (const b of EDGES) for (const name of OPERATIONS) check(name, a, b);
});

test('random doubles over every exponent, and near neighbours, round as the CPU rounds', () => {
  const pool = values(7, 600);
  const next = random(8);
  for (let i = 0; i < 6000; i++) {
    const a = pool[Math.floor(next() * pool.length)];
    // Half the time a neighbour: same magnitude, so subtraction cancels and addition carries.
    const b =
      next() < 0.5 ? pool[Math.floor(next() * pool.length)] : a * (1 + (next() - 0.5) * 2 ** -40);
    for (const name of OPERATIONS) check(name, a, b);
  }
});

test('ties round to even, and products fall into and out of the subnormal range', () => {
  // 1 + 2^-53 lies halfway between 1 and its successor: even goes down, odd goes up.
  check('dAdd', 1, 2 ** -53);
  check('dAdd', 1 + 2 ** -52, 2 ** -53);
  check('dAdd', 2 ** 53, 1);
  check('dAdd', 2 ** 53 + 2, 1);
  for (let k = 0; k < 80; k++) {
    check('dMul', 2 ** (-1000 - k), 1.5 ** (k % 7) * 2 ** -40);
    check('dMul', 3 * 2 ** (-1074 + k), 1 / 3);
    check('dMul', 2 ** (1000 - k), 2 ** 40 * 1.75);
    check('dAdd', 5e-324 * (k + 1), -5e-324 * k);
  }
});

test('quotients round once: ties, subnormal and overflowing results, reciprocals of determinants', () => {
  const next = random(9);
  for (let k = 0; k < 80; k++) {
    check('dDiv', 1, 3 + k);
    check('dDiv', 2 ** (-1000 - k), 2 ** 60 * (1 + next()));
    check('dDiv', 5e-324 * (k + 1), 3);
    check('dDiv', 2 ** (1000 + (k % 24)), 2 ** -30 * (1 + next()));
    check('dDiv', 1, (next() - 0.5) * 10 ** Math.floor(next() * 40 - 20));
    // A quotient exact in 54 bits lies halfway between two doubles: it rounds to the even one.
    check('dDiv', (2 ** 53 + 2 * k + 1) * 2 ** -10, 2);
  }
});
