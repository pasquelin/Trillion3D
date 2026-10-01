import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute } from './attribute.ts';
import { normalisedUnit } from './elements.ts';

test('signed normalized endpoints are symmetric, including the most negative integer', () => {
  for (const [Kind, min, max] of [
    [Int8Array, -128, 127],
    [Int16Array, -32768, 32767],
    [Int32Array, -2147483648, 2147483647],
  ] as const) {
    const value = new BufferAttribute(new Kind([min, -max, 0, max]), 4, true);
    assert.deepEqual([value.getX(0), value.getY(0), value.getZ(0), value.getW(0)], [-1, -1, 0, 1]);
    value.setXY(0, -0.25, 0.25);
    assert.ok(Math.abs(value.getX(0) + 0.25) <= normalisedUnit(Kind));
    assert.ok(Math.abs(value.getY(0) - 0.25) <= normalisedUnit(Kind));
    value.setZ(0, -1).setW(0, 1);
    assert.deepEqual([...value.array.slice(2)], [-max, max]);
    value.array[0] = 1;
    assert.equal(value.getX(0), normalisedUnit(Kind));
  }
});

test('unsigned normalization handles the complete range without signed clamping', () => {
  for (const [Kind, max] of [
    [Uint8Array, 255],
    [Uint16Array, 65535],
    [Uint32Array, 4294967295],
  ] as const) {
    const value = new BufferAttribute(new Kind([0, 1, max]), 3, true);
    assert.equal(value.getX(0), 0);
    assert.equal(value.getY(0), normalisedUnit(Kind));
    assert.equal(value.getZ(0), 1);
    value.setXY(0, 1, 0);
    assert.deepEqual([...value.array], [max, 0, max]);
  }
});

test('normalized floating attributes stay in physical units and missing components read zero', () => {
  for (const Kind of [Float32Array, Float64Array]) {
    const value = new BufferAttribute(new Kind([2.5, -3, 8, 9]), 2, true);
    assert.equal(value.name, '');
    assert.deepEqual([value.getX(0), value.getY(0), value.getZ(0), value.getW(0)], [2.5, -3, 0, 0]);
    assert.equal(normalisedUnit(Kind), 1);
    assert.equal(value.setXY(1, 0.25, -4), value);
    assert.deepEqual([...value.array], [2.5, -3, 0.25, -4]);
  }
});
