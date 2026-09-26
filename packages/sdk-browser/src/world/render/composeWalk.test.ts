// #349: the effect chain's refusal of a multiply or subtractive surface on WebGL2 is read from the
// draw's own walk of its graph. A frame with a chain visits every node exactly as often as a frame
// without one: the composer walks nothing, and the draw walks once per image, as on develop.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { createFrameComposer } from './compose.ts';

const FRAMES = 5;
const halfFloats = {
  getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
};

/** A graph of nested groups and meshes whose every read of a node's children is counted. */
function countedScene() {
  const scene = new GraphScene();
  const group = new Group();
  group.add(G.triangleMesh(new GraphSurface('standard')));
  group.add(G.triangleMesh(new GraphSurface('standard', { transparent: true, opacity: 0.5 })));
  scene.add(group, G.triangleMesh(new GraphSurface('standard')));
  const visits = { count: 0 };
  scene.traverse((node) => {
    const children = node.children;
    Object.defineProperty(node, 'children', {
      get: () => (visits.count++, children),
    });
  });
  return { scene, visits };
}

/** The children reads of `FRAMES` drawn frames, the chain holding `passes`: nothing holds a
 *  frame here (`frameHeld` is absent), so each composes and draws. */
function visitsOver(passes: number) {
  const { scene, visits } = countedScene();
  const chain = new EffectChain();
  for (let i = 0; i < passes; i++) chain.add(effect.bloom());
  const context = createTestContext({ answers: halfFloats });
  const draw = createSceneDraw(context.gl, scene);
  const backend = { id: 'engine', scene, ...draw, ...draw.host } as unknown as RenderBackend;
  const compose = createFrameComposer(context.gl, G.perspectiveCamera(), {
    effects: { chain, shown: () => true },
  });
  const drawn = context.of('drawElements').length;
  visits.count = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    draw.render(G.perspectiveCamera());
    compose(backend, null);
  }
  assert.equal(context.of('drawElements').length - drawn, 3 * FRAMES, 'every frame drawn');
  return visits.count;
}

test('a chain on WebGL2 visits the graph no more than the draw does without one', () => {
  const without = visitsOver(0);
  assert.ok(without > 0, 'the draw walks its graph');
  assert.equal(visitsOver(1), without, 'the composer walks nothing of its own');
});
