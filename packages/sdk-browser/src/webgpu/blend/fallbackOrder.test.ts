import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { orderVisibleBlend } from './order.ts';
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts';

function stateAt(xs: number[]) {
  const state = createWebgpuBlendState();
  state.blendGpu = xs.map(
    (x) => ({ matrix: new G.Matrix4().makeTranslation(x, 0, 0) }) as BlendGpuItem,
  );
  state.visibleBlend = [...state.blendGpu];
  return state;
}

test('fallback ranking preserves source ties through jumps and changing visible subsets', () => {
  const xs = Array.from({ length: 600 }, (_, i) => (i >> 1) - 150);
  const state = stateAt(xs);
  for (const eye of [0, 500, -500, 0]) {
    const expected = [...state.visibleBlend].sort((a, b) => {
      const rankA = state.blendGpu.indexOf(a),
        rankB = state.blendGpu.indexOf(b);
      return (xs[rankB] - eye) ** 2 - (xs[rankA] - eye) ** 2 || rankA - rankB;
    });
    orderVisibleBlend(state, [eye, 0, 0]);
    assert.deepEqual(state.visibleBlend, expected);
    const capacity = state.fallbackOrder;
    state.visibleBlend = state.visibleBlend.filter((_, i) => i % 3 !== 0);
    orderVisibleBlend(state, [eye, 0, 0]);
    assert.equal(state.fallbackOrder, capacity, 'a smaller visible subset reuses its buffer');
    assert.deepEqual(
      state.visibleBlend,
      expected.filter((_, i) => i % 3 !== 0),
    );
  }
});

test('fallback keeps NaN barriers and handles infinite and equal keys as insertion did', () => {
  const state = stateAt([1, 2, NaN, 3, Infinity, 3]);
  orderVisibleBlend(state, [0, 0, 0]);
  assert.deepEqual(
    state.visibleBlend.map((item) => item.orderRank),
    [1, 0, 2, 4, 3, 5],
  );
  const before = [...state.visibleBlend];
  orderVisibleBlend(state, undefined);
  assert.deepEqual(state.visibleBlend, before);
  state.visibleBlend = [];
  orderVisibleBlend(state, [0, 0, 0]);
  assert.deepEqual(state.visibleBlend, []);
});
