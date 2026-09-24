import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import {
  buildBlendStatics,
  planCull,
  planPipeline,
  planVertexCull,
  refreshBlendPlan,
} from './plan.ts';
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts';
import { surfaceOf } from '../../page/surface.ts';

/** The blend plan of a lone item, everything but its material left at its simplest. */
function plan(material: G.GraphSurface | G.GraphSurface[], paged = false) {
  const blendState = createWebgpuBlendState();
  blendState.blendGpu.push({
    surface: surfaceOf(material),
    matrix: new G.Matrix4(),
    count: 3,
    paged,
  } as unknown as BlendGpuItem);
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  return [...blendState.orders[0]];
}

test('an item that declares no material plans the host default side: one front entry, not a crash', () => {
  const front = plan(G.basicSurface({ side: G.FRONT_SIDE }));
  assert.equal(front.length, 1);
  assert.deepEqual(plan([]), front, 'an empty material array declares nothing: front');
});

test('a double-sided paged item plans back then face on the pipeline that culls nothing', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE }), true);
  // Back first: the pass culls the face (1), then the back (2); the vertex stage applies both.
  assert.deepEqual(entries.map(planCull), [1, 2]);
  assert.deepEqual(entries.map(planPipeline), [0, 0]);
  assert.deepEqual(entries.map(planVertexCull), [1, 2]);
});

test('a double-sided unpaged item keeps the hardware cull of its two pipelines', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE }));
  assert.deepEqual(entries.map(planPipeline), [1, 2]);
  assert.deepEqual(entries.map(planVertexCull), [0, 0]);
});
