import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alignDown,
  alignUp,
  bitWords,
  ceilDiv,
  floorLog2,
  isPow2,
  nextPow2,
  workgroupCount,
} from './integers.ts'
import { clamp, clampCompare, clampLowWins, lerp, saturate, wrap } from './reals.ts'
import { quantile } from './quantile.ts'

test('ceilDiv rounds up, exact at multiples, zero count and NaN', () => {
  assert.equal(ceilDiv(10, 5), 2)
  assert.equal(ceilDiv(11, 5), 3)
  assert.equal(ceilDiv(0, 5), 0)
  assert.equal(ceilDiv(1, 64), 1)
  assert.equal(ceilDiv(2.5, 1), 3)
  assert.equal(ceilDiv(-3, 2), -1)
  assert.ok(Object.is(ceilDiv(-0, 4), -0))
  assert.ok(Number.isNaN(ceilDiv(NaN, 4)))
  assert.equal(ceilDiv(1, 0), Infinity)
})

test('workgroupCount holds one group at least', () => {
  assert.equal(workgroupCount(0, 64), 1)
  assert.equal(workgroupCount(-5, 64), 1)
  assert.equal(workgroupCount(64, 64), 1)
  assert.equal(workgroupCount(65, 64), 2)
  assert.equal(workgroupCount(2 ** 31, 256), 2 ** 23)
  assert.ok(Number.isNaN(workgroupCount(NaN, 64)))
})

test('alignUp and alignDown to a multiple', () => {
  assert.equal(alignUp(0, 256), 0)
  assert.equal(alignUp(1, 256), 256)
  assert.equal(alignUp(256, 256), 256)
  assert.equal(alignUp(257, 6), 258)
  assert.equal(alignUp(5.5, 4), 8)
  assert.equal(alignUp(-1, 4) === 0, true)
  assert.equal(alignDown(0, 256), 0)
  assert.equal(alignDown(255, 256), 0)
  assert.equal(alignDown(256, 256), 256)
  assert.equal(alignDown(-1, 4), -4)
  assert.equal(alignDown(7.9, 4), 4)
  assert.ok(Number.isNaN(alignUp(NaN, 4)))
  assert.ok(Number.isNaN(alignDown(NaN, 4)))
})

test('nextPow2 is 1 at least and exact on powers', () => {
  for (const v of [-5, -0, 0, 0.5, 1]) assert.equal(nextPow2(v), 1)
  assert.equal(nextPow2(2), 2)
  assert.equal(nextPow2(3), 4)
  assert.equal(nextPow2(1024), 1024)
  assert.equal(nextPow2(1025), 2048)
  assert.equal(nextPow2(1.5), 2)
  assert.equal(nextPow2(2 ** 31), 2 ** 31)
  assert.equal(nextPow2(2 ** 31 + 1), 2 ** 32)
  assert.ok(Number.isNaN(nextPow2(NaN)))
})

test('nextPow2 by clz32 agrees with the logarithm form on integers', () => {
  const old = (v: number) => (v <= 1 ? 1 : 2 ** Math.ceil(Math.log2(v)))
  for (let v = 1; v <= 2 ** 20; v++) assert.equal(nextPow2(v), old(v), `v = ${v}`)
  for (let k = 0; k <= 31; k++)
    for (const v of [2 ** k - 1, 2 ** k, 2 ** k + 1])
      if (v >= 1) assert.equal(nextPow2(v), old(v), `v = ${v}`)
})

test('floorLog2 and isPow2', () => {
  assert.equal(floorLog2(1), 0)
  assert.equal(floorLog2(2), 1)
  assert.equal(floorLog2(3), 1)
  assert.equal(floorLog2(1023), 9)
  assert.equal(floorLog2(1024), 10)
  assert.equal(floorLog2(2 ** 31), 31)
  assert.equal(floorLog2(0), -1)
  assert.equal(floorLog2(NaN), -1)
  assert.equal(isPow2(1), true)
  assert.equal(isPow2(2), true)
  assert.equal(isPow2(2 ** 30), true)
  assert.equal(isPow2(3), false)
  assert.equal(isPow2(0), false)
  assert.equal(isPow2(-0), false)
  assert.equal(isPow2(-4), false)
  assert.equal(isPow2(NaN), false)
})

test('bitWords counts 32-bit words', () => {
  assert.equal(bitWords(0), 0)
  assert.equal(bitWords(1), 1)
  assert.equal(bitWords(32), 1)
  assert.equal(bitWords(33), 2)
  assert.equal(bitWords(2 ** 32 - 32), 2 ** 27 - 1)
  assert.equal(bitWords(NaN), 0)
  assert.equal(bitWords(-0), 0)
})

test('clamp: upper bound wins when lo > hi, NaN propagates, -0 becomes +0', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-5, 0, 3), 0)
  assert.equal(clamp(2, 0, 3), 2)
  assert.equal(clamp(0, 0, 3), 0)
  assert.equal(clamp(3, 0, 3), 3)
  assert.equal(clamp(Infinity, -1, 1), 1)
  assert.equal(clamp(-Infinity, -1, 1), -1)
  assert.equal(clamp(0.5, 3, 0), 0)
  assert.equal(clamp(10, 3, 0), 0)
  assert.ok(Number.isNaN(clamp(NaN, 0, 1)))
  assert.ok(Number.isNaN(clamp(0.5, NaN, 1)))
  assert.ok(Number.isNaN(clamp(0.5, 0, NaN)))
  assert.ok(Object.is(clamp(-0, 0, 1), 0))
  assert.ok(Object.is(clamp(-0, -1, 1), -0))
})

test('clampLowWins: lower bound wins when lo > hi, NaN propagates', () => {
  assert.equal(clampLowWins(5, 0, 3), 3)
  assert.equal(clampLowWins(-5, 0, 3), 0)
  assert.equal(clampLowWins(2, 0, 3), 2)
  assert.equal(clampLowWins(0.5, 3, 0), 3)
  assert.equal(clampLowWins(10, 3, 0), 3)
  assert.equal(clampLowWins(Infinity, -1, 1), 1)
  assert.ok(Number.isNaN(clampLowWins(NaN, 0, 1)))
  assert.ok(Number.isNaN(clampLowWins(0.5, NaN, 1)))
  assert.ok(Number.isNaN(clampLowWins(0.5, 0, NaN)))
  for (const x of [-2, 0, 0.5, 1, 9]) assert.equal(clampLowWins(x, 0, 1), clamp(x, 0, 1))
})

test('clampCompare: comparison order, -0 kept, NaN bounds pass x through', () => {
  assert.equal(clampCompare(5, 0, 3), 3)
  assert.equal(clampCompare(-5, 0, 3), 0)
  assert.equal(clampCompare(2, 0, 3), 2)
  assert.equal(clampCompare(0.5, 3, 0), 3)
  assert.equal(clampCompare(3, 3, 0), 0)
  assert.equal(clampCompare(10, 3, 0), 0)
  assert.ok(Object.is(clampCompare(-0, 0, 1), -0))
  assert.ok(Object.is(clampCompare(0, -1, -0), 0))
  assert.ok(Number.isNaN(clampCompare(NaN, 0, 1)))
  assert.equal(clampCompare(0.5, NaN, 1), 0.5)
  assert.equal(clampCompare(2, NaN, 1), 1)
  assert.equal(clampCompare(0.5, 0, NaN), 0.5)
  assert.equal(clampCompare(-1, 0, NaN), 0)
  for (const x of [-2, 0, 0.5, 1, 9]) assert.equal(clampCompare(x, 0, 1), clamp(x, 0, 1))
})

test('saturate holds [0, 1]', () => {
  assert.equal(saturate(-1), 0)
  assert.equal(saturate(2), 1)
  assert.equal(saturate(0.25), 0.25)
  assert.ok(Object.is(saturate(-0), 0))
  assert.ok(Number.isNaN(saturate(NaN)))
})

test('lerp is exact at 0, extrapolates, propagates NaN', () => {
  assert.equal(lerp(2, 6, 0), 2)
  assert.equal(lerp(2, 6, 1), 6)
  assert.equal(lerp(2, 6, 0.5), 4)
  assert.equal(lerp(2, 6, 2), 10)
  assert.equal(lerp(2, 6, -1), -2)
  assert.equal(lerp(3, 3, 0.7), 3)
  assert.ok(Number.isNaN(lerp(0, 1, NaN)))
})

test('wrap is a floored modulo', () => {
  assert.equal(wrap(5, 3), 2)
  assert.equal(wrap(-1, 3), 2)
  assert.equal(wrap(3, 3), 0)
  assert.equal(wrap(-3, 3), 0)
  assert.equal(wrap(0.25, 1), 0.25)
  assert.equal(wrap(-0.25, 1), 0.75)
  assert.equal(wrap(1.5, 1), 0.5)
  assert.ok(Object.is(wrap(-0, 1), 0))
  assert.equal(wrap(-1e-17, 1), 0)
  assert.ok(Number.isNaN(wrap(NaN, 1)))
  assert.ok(Number.isNaN(wrap(Infinity, 1)))
  assert.ok(Number.isNaN(wrap(1, 0)))
})

test('quantile is the nearest rank', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(quantile(ten, 0.5), 5)
  assert.equal(quantile(ten, 0.95), 10)
  assert.equal(quantile(ten, 1), 10)
  assert.equal(quantile(ten, 0.1), 1)
  assert.equal(quantile(ten, 0.11), 2)
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1)
  assert.equal(quantile(twenty, 0.95), 19)
  assert.equal(quantile([7], 0.5), 7)
  assert.equal(quantile(new Float64Array([1, 2, 3]), 0.5), 2)
  assert.equal(quantile([], 0.5), undefined)
  assert.equal(quantile(ten, 0), undefined)
  assert.equal(quantile(ten, NaN), undefined)
})
