// #349, audit of #651: on WebGL2 the effect chain's linear target cannot hold a transparent surface
// that blends in multiply or subtractive. Whichever comes first — the pass, the surface, the
// switch of its mode, or a WebGL2 session opened on a world that holds both — the frame keeps
// drawing every surface, without the chain, and the world says so once; the chain comes back
// once no such surface is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphInstancedMesh } from '../../host/graph/mesh.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import {
  HOST_BLENDING_MULTIPLY,
  HOST_BLENDING_NORMAL,
  HOST_BLENDING_SUBTRACTIVE,
} from '../../host/surfaceConstants.ts';
import { createUnlitAlbedo } from '../../lighting/unlitAlbedo.ts';
import { heard, session } from './composeSession.fixture.ts';

const blended = (blending: number) =>
  new GraphSurface('standard', { transparent: true, opacity: 0.5, blending });

const MODES = [
  ['multiply', HOST_BLENDING_MULTIPLY],
  ['subtractive', HOST_BLENDING_SUBTRACTIVE],
] as const;

for (const [name, blending] of MODES) {
  test(`a pass added while a ${name} surface is drawn: every frame drawn, said once`, async () => {
    const scene = new GraphScene().add(
      G.triangleMesh(new GraphSurface('standard')),
      G.triangleMesh(blended(blending)),
    );
    const chain = new EffectChain();
    const view = session(scene, chain);
    const said = await heard(view, () => {
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
      chain.add(effect.bloom());
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 }, 'no throw, no hole');
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
    });
    assert.deepEqual(said, ['effects-refused-blending']);
  });

  test(`a ${name} surface entering a world with a pass: drawn, said once`, async () => {
    const scene = new GraphScene().add(G.triangleMesh(new GraphSurface('standard')));
    const view = session(scene, new EffectChain().add(effect.bloom()));
    const glass = G.triangleMesh(blended(blending));
    const said = await heard(view, () => {
      assert.deepEqual(view.frame(), { chained: true, submitted: 1 });
      scene.add(glass);
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
      assert.deepEqual(view.frame(), { chained: false, submitted: 2 });
      // The chain comes back once no such surface is drawn.
      glass.visible = false;
      assert.deepEqual(view.frame(), { chained: true, submitted: 1 });
    });
    assert.deepEqual(said, ['effects-refused-blending']);
  });

  test(`a surface switched to ${name} under a pass: drawn, said once`, async () => {
    const surface = blended(HOST_BLENDING_NORMAL);
    const view = session(
      new GraphScene().add(G.triangleMesh(surface)),
      new EffectChain().add(effect.bloom()),
    );
    const said = await heard(view, () => {
      assert.deepEqual(view.frame(), { chained: true, submitted: 1 });
      surface.blending = blending;
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 });
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 });
    });
    assert.deepEqual(said, ['effects-refused-blending']);
  });

  test(`a WebGL2 session opened on a world with a pass and a ${name} surface`, async () => {
    // The world falling back to WebGL2 opens its session on what it already holds.
    const scene = new GraphScene().add(G.triangleMesh(blended(blending)));
    const view = session(scene, new EffectChain().add(effect.bloom()));
    const said = await heard(view, () => {
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 }, 'its first frame drawn');
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 });
    });
    assert.deepEqual(said, ['effects-refused-blending']);
  });
}

test('a multiply instanced mesh placed nowhere keeps the chain on until it is placed', async () => {
  const surface = blended(HOST_BLENDING_MULTIPLY),
    pool = new GraphInstancedMesh(G.triangleMesh(surface).geometry, surface, 1);
  pool.count = 0;
  pool.frustumCulled = false;
  const scene = new GraphScene().add(G.triangleMesh(new GraphSurface('standard')), pool);
  const view = session(scene, new EffectChain().add(effect.bloom()));
  const said = await heard(view, () => {
    assert.equal(view.frame().chained, true, 'nothing submitted, nothing refused');
    pool.count = 1;
    assert.equal(view.frame().chained, false);
  });
  assert.deepEqual(said, ['effects-refused-blending']);
});

test('a transmissive multiply surface in the unlit view, which zeroes its transmission', async () => {
  // The view zeroes the transmission before the draw reads the surface: the draw then binds it
  // in multiply, so the chain is off on that frame whatever the surface declares.
  const glass = new GraphSurface('physical', {
    transparent: true,
    opacity: 0.5,
    transmission: 1,
    blending: HOST_BLENDING_MULTIPLY,
  });
  const scene = new GraphScene().add(G.triangleMesh(glass));
  createUnlitAlbedo(scene).setEnabled(true);
  const view = session(scene, new EffectChain().add(effect.bloom()));
  const said = await heard(view, () => {
    assert.deepEqual(view.frame(), { chained: false, submitted: 1 }, 'no throw, no hole');
  });
  assert.equal(glass.transmission, 1, 'the view gives the surface back');
  assert.deepEqual(said, ['effects-refused-blending']);
});
