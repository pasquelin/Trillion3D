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
import { HOST_BLENDING_MULTIPLY } from '../../host/surfaceConstants.ts';
import { session } from './composeSession.fixture.ts';

const FRAMES = 5;

/** A nested graph drawn with `chain`, each read of a node's children counted in `visits()`. */
function counted(chain: EffectChain) {
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
  return { view, visits: () => visits, reset: () => void (visits = 0) };
}

/** The reads of every node's children over `FRAMES` frames, none held, each composed and drawn. */
function visitsOver(chain: EffectChain, chained: boolean) {
  const { view, visits, reset } = counted(chain);
  reset();
  for (let frame = 0; frame < FRAMES; frame++)
    assert.deepEqual(view.frame(), { chained, submitted: 3 }, 'every frame drawn');
  view.close();
  return visits();
}

test('a chain on WebGL2 visits the graph no more than the draw does without one', () => {
  const without = visitsOver(new EffectChain(), false);
  assert.ok(without > 0, 'the draw walks its graph');
  assert.equal(
    visitsOver(new EffectChain().add(effect.bloom()), true),
    without,
    'the composer walks nothing',
  );
});

test('a held frame walks nothing, with or without a chain', () => {
  for (const chain of [new EffectChain(), new EffectChain().add(effect.bloom())]) {
    const { view, visits, reset } = counted(chain);
    view.frame();
    view.hold(true);
    reset();
    for (let frame = 0; frame < FRAMES; frame++)
      assert.deepEqual(view.frame(), { chained: false, submitted: 0 }, 'the kept image put back');
    assert.equal(visits(), 0);
    view.close();
  }
});

test('a surface the engine writes after its render is read by the refusal and the draw', () => {
  const scene = new GraphScene().add(G.triangleMesh(new GraphSurface('standard')));
  const view = session(scene, new EffectChain().add(effect.bloom()));
  const glass = G.triangleMesh(
    new GraphSurface('standard', {
      transparent: true,
      opacity: 0.5,
      blending: HOST_BLENDING_MULTIPLY,
    }),
  );
  assert.deepEqual(view.frame(), { chained: true, submitted: 1 });
  // Written between `render` and the composition, as the engine's frame writes its graph.
  assert.deepEqual(
    view.frame(() => scene.add(glass)),
    { chained: false, submitted: 2 },
  );
  assert.deepEqual(
    view.frame(() => (glass.visible = false)),
    { chained: true, submitted: 1 },
  );
  view.close();
});
