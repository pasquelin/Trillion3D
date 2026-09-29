// Physical extensions supported by WebGL2 draw silently; unsupported ones retain one notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { Scene } from '../core/scene.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import { heard, session } from './composeSession.fixture.ts';

test('clearcoat draws silently on WebGL2 and adding unsupported sheen reports it once', async () => {
  const coat = new GraphSurface('physical', { clearcoat: 1, clearcoatRoughness: 0.1 });
  const scene = new Scene().add(G.triangleMesh(coat), G.triangleMesh(coat));
  const view = session(scene, new EffectChain());
  // The two meshes share one submission per pass: the unfogged reflection source and final draw.
  const said = await heard(view, () => {
    for (let frame = 0; frame < 3; frame++)
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
    // A second feature of the same surface is its own notice; a known one is never said again.
    coat.sheen = 1;
    coat.needsUpdate = true;
    assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
    assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
  });
  assert.deepEqual(said, ['material-degraded']);
});

test('a surface with no feature WebGL2 lacks says nothing', async () => {
  const scene = new Scene().add(
    G.triangleMesh(new GraphSurface('physical')),
    G.triangleMesh(new GraphSurface('standard')),
  );
  const view = session(scene, new EffectChain());
  const said = await heard(view, () => {
    assert.deepEqual(view.frame(), { chained: false, submitted: 4 });
  });
  assert.deepEqual(said, []);
});

// #558: a clearcoat set on a live surface without `needsUpdate` is read on the next draw.
test('a clearcoat set without needsUpdate remains supported', async () => {
  const coat = new GraphSurface('physical');
  const view = session(new Scene().add(G.triangleMesh(coat)), new EffectChain());
  const said = await heard(view, () => {
    view.frame();
    coat.clearcoat = 1;
    view.frame();
    view.frame();
  });
  assert.deepEqual(said, []);
});

// #558: a surface the gate refuses stopped the whole frame; it alone is left out now, by name.
test('a refused surface is left out alone, said once, the loop never stopped', async () => {
  const refused = new GraphSurface('standard', { alphaHash: true });
  const scene = new Scene().add(
    G.triangleMesh(new GraphSurface('standard')),
    G.triangleMesh(refused),
    G.triangleMesh(new GraphSurface('basic')),
  );
  const view = session(scene, new EffectChain());
  const said = await heard(view, () => {
    for (let frame = 0; frame < 3; frame++)
      assert.deepEqual(view.frame(), { chained: false, submitted: 4 });
    // Once the surface is admitted again, it draws with the others.
    refused.alphaHash = false;
    assert.deepEqual(view.frame(), { chained: false, submitted: 6 });
  });
  assert.deepEqual(said, ['material-refused']);
});
