import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { buildBlendStatics, refreshBlendPlan } from './plan.ts';
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts';
import { surfaceOf } from '../../page/surface.ts';

/** The blend plan of a lone item, everything but its material left at its simplest. */
function plan(material: G.GraphSurface | G.GraphSurface[]) {
  const blendState = createWebgpuBlendState();
  blendState.blendGpu.push({
    surface: surfaceOf(material),
    matrix: new G.Matrix4(),
    count: 3,
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
