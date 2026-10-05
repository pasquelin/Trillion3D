import assert from 'node:assert/strict';
import test from 'node:test';
import { fdlibmAcos, fdlibmSin } from './trig.ts';

// `libm` 0.2.16's own `sin` and `acos` (the Rust crate the WebAssembly sampler transcribes too),
// as bit patterns: x, sin x, acos x. On every branch of the reduction below 2^20 · π/2 — the
// kernels, one to four quarter turns, the near multiples of π/2 — and of the arc cosine.
const LIBM: [string, string, string][] = [
  ['3fb999999999999a', '3fb98eaecb8bcb2c', '3ff787b22ce3f590'],
  ['3fe0000000000000', '3fdeaee8744b05f0', '3ff0c152382d7366'],
  ['3fe921fb54442d18', '3fe6a09e667f3bcc', '3fe55bcf3c4a4694'],
  ['3fe921fb54442d19', '3fe6a09e667f3bcd', '3fe55bcf3c4a4692'],
  ['3ff0000000000000', '3feaed548f090cee', '0000000000000000'],
  ['3ff921fb54442d18', '3ff0000000000000', '7ff8000000000000'],
  ['3ff921fb54442d19', '3ff0000000000000', '7ff8000000000000'],
  ['3ff921fb53ff74e9', '3ff0000000000000', '7ff8000000000000'],
  ['4000000000000000', '3fed18f6ead1b446', '7ff8000000000000'],
  ['4002d97c7f3321d2', '3fe6a09e667f3bcd', '7ff8000000000000'],
  ['400921fb54442d18', '3ca1a62633145c07', '7ff8000000000000'],
  ['400f6a7a2955385e', 'bfe6a09e667f3bcc', '7ff8000000000000'],
  ['4012d97c7f3321d2', 'bff0000000000000', '7ff8000000000000'],
  ['4015fdbbe9bba775', 'bfe6a09e667f3bce', '7ff8000000000000'],
  ['401921fb54442d18', 'bcb1a62633145c07', '7ff8000000000000'],
  ['401c463abeccb2bb', '3fe6a09e667f3bcb', '7ff8000000000000'],
  ['4024000000000000', 'bfe1689ef5f34f52', '7ff8000000000000'],
  ['408f400000000000', '3fea75cc150a206b', '7ff8000000000000'],
  ['40f86a0000000000', '3fa24daa9c527e96', '7ff8000000000000'],
  ['413921fa80000000', 'bfe79884537efa1d', '7ff8000000000000'],
  ['bfd3333333333333', 'bfd2e9cd95baba33', '3ffe0200bbc96ad8'],
  ['bff921fb54442d18', 'bff0000000000000', '7ff8000000000000'],
  ['c008000000000000', 'bfc210386db6d55b', '7ff8000000000000'],
  ['3fefffffffffffff', '3feaed548f090ced', '3e50000000000000'],
  ['3fe8000000000000', '3fe5cffc16bf8f0d', '3fe720a392c1d955'],
  ['bfe8000000000000', 'bfe5cffc16bf8f0d', '400359d26f93b6c3'],
  ['3e112e0be826d695', '3e112e0be826d695', '3ff921fb53ff74e9'],
  ['bfe0000000000000', 'bfdeaee8744b05f0', '4000c152382d7366'],
  ['3fdfffffffffffff', '3fdeaee8744b05ef', '3ff0c152382d7366'],
];

const bits = new Float64Array(1),
  words = new BigUint64Array(bits.buffer);
const of = (hex: string) => ((words[0] = BigInt('0x' + hex)), bits[0]);
const hex = (x: number) => ((bits[0] = x), words[0].toString(16).padStart(16, '0'));

test('the sine and the arc cosine carry the bits of libm', () => {
  for (const [x, sin, acos] of LIBM) {
    assert.equal(hex(fdlibmSin(of(x))), sin, `sin(${of(x)})`);
    const a = fdlibmAcos(of(x));
    assert.ok(hex(a) === acos || (Number.isNaN(a) && Number.isNaN(of(acos))), `acos(${of(x)})`);
  }
});

test('the specials of both, and Math.sin past the reduction this file carries', () => {
  assert.ok(
    Object.is(fdlibmSin(-0), -0) &&
      Number.isNaN(fdlibmSin(Infinity)) &&
      Number.isNaN(fdlibmSin(NaN)),
  );
  assert.equal(fdlibmSin(1e7), Math.sin(1e7));
  assert.ok(
    Object.is(fdlibmAcos(1), 0) && fdlibmAcos(-1) === Math.PI && Number.isNaN(fdlibmAcos(1.5)),
  );
});
