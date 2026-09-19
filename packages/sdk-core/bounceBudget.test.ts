// Common formulas batch: bounceBatchOf, factorized from 2 copies (probe pass and surface
// cache), which both clamp on the same rounding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bounceBatchOf } from './bounceBudget.ts';

test('bounceBatchOf rounds the product of ceiling and load to nearest integer', () => {
  assert.equal(bounceBatchOf(100, 0.5), 50);
  assert.equal(bounceBatchOf(10, 0.34), 3);
  assert.equal(bounceBatchOf(10, 0.36), 4);
});

test('bounceBatchOf never returns less than one, even with tiny load on small ceiling', () => {
  assert.equal(bounceBatchOf(1, 0.01), 1);
  assert.equal(bounceBatchOf(4, 0.05), 1);
  assert.equal(bounceBatchOf(0, 1), 1);
});

test('bounceBatchOf clamps to published ceiling when load equals one', () => {
  assert.equal(bounceBatchOf(256, 1), 256);
});
