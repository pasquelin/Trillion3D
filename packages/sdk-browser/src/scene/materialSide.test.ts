import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { hostSide, sideOf } from './materialSide.ts';

test('sideOf: each host side constant maps to its engine name, the first of an array decides', () => {
  const front = G.basicSurface({ side: G.FRONT_SIDE }),
    back = G.basicSurface({ side: G.BACK_SIDE }),
    double = G.basicSurface({ side: G.DOUBLE_SIDE });
  assert.equal(sideOf(front), 'front');
  assert.equal(sideOf(back), 'back');
  assert.equal(sideOf(double), 'double');
  assert.equal(sideOf([back, double]), 'back');
  assert.equal(sideOf(G.basicSurface()), 'front', 'the host default is front');
  assert.equal(sideOf([]), 'front', 'an empty array declares nothing: front, not a crash');
});

test('hostSide: each engine name maps back to the host constant the library draws with', () => {
  assert.equal(hostSide('front'), G.FRONT_SIDE);
  assert.equal(hostSide('back'), G.BACK_SIDE);
  assert.equal(hostSide('double'), G.DOUBLE_SIDE);
  for (const side of ['front', 'back', 'double'] as const)
    assert.equal(sideOf(G.basicSurface({ side: hostSide(side) as number })), side, side);
});
