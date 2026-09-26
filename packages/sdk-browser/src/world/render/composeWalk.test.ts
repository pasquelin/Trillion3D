// #349: the effect chain's refusal of a multiply or subtractive surface on WebGL2 is read from the
// draw's own walk of its graph. A frame with a chain visits every node exactly as often as a frame
// without one: the composer walks nothing, and the draw walks once per image, as on develop.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { session } from './composeSession.fixture.ts';

const FRAMES = 5;

/** The reads of every node's children over `FRAMES` frames of a nested graph, drawn with `chain`:
 *  nothing holds a frame here (the draw has no `frameHeld`), so each composes and draws. */
function visitsOver(chain: EffectChain) {
  const scene = new GraphScene(),
    group = new Group();
  group.add(G.triangleMesh(new GraphSurface('standard')));
  group.add(G.triangleMesh(new GraphSurface('standard', { transparent: true, opacity: 0.5 })));
  scene.add(group, G.triangleMesh(new GraphSurface('standard')));
  let visits = 0;
  scene.traverse((node) => {
    const children = node.children;
    Object.defineProperty(node, 'children', { get: () => (visits++, children) });
  });
  const view = session(scene, chain);
  visits = 0;
  for (let frame = 0; frame < FRAMES; frame++)
    assert.equal(view.frame().submitted, 3, 'every frame drawn');
  view.close();
  return visits;
}

test('a chain on WebGL2 visits the graph no more than the draw does without one', () => {
  const without = visitsOver(new EffectChain());
  assert.ok(without > 0, 'the draw walks its graph');
  assert.equal(
    visitsOver(new EffectChain().add(effect.bloom())),
    without,
    'the composer walks nothing',
  );
});
