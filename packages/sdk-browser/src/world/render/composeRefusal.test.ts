// #349, audit of #651: on WebGL2 the effect chain's linear target cannot hold a transparent surface
// that blends in multiply or subtractive. Whichever comes first — the pass, the surface, the
// switch of its mode, or a WebGL2 session opened on a world that holds both — the frame keeps
// drawing every surface, without the chain, and the world says so once; the chain comes back
// once no such surface is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphScene } from '../../host/graph/scene.ts';
import { GraphMesh } from '../../host/graph/mesh.ts';
import { GraphSurface } from '../../host/graph/surface.ts';
import {
  HOST_BLENDING_MULTIPLY,
  HOST_BLENDING_NORMAL,
  HOST_BLENDING_SUBTRACTIVE,
} from '../../host/surfaceConstants.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import {
  createWorldNotices,
  listenWorldNotices,
  noticeEffectRefusal,
} from '../diagnostic/worldNotices.ts';
import { createFrameComposer } from './compose.ts';

const camera = G.perspectiveCamera();
const halfFloats = {
  getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
};

/** A drawn mesh of three corners in `surface`. */
function mesh(surface: GraphSurface) {
  const geometry = new Geometry().setIndex(new BufferAttribute(new Uint32Array(3), 1));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3));
  const made = new GraphMesh(geometry, surface);
  made.frustumCulled = false;
  return made;
}
const blended = (blending: number) =>
  new GraphSurface('standard', { transparent: true, opacity: 0.5, blending });

/** A WebGL2 session drawing `scene` with the world's `chain`, its refusals said on a world's
 *  notices; `frame` draws one and returns whether the chain ran and what the scene submitted. */
function session(scene: GraphScene, chain: EffectChain) {
  const context = createTestContext({ answers: halfFloats });
  const draw = createSceneDraw(context.gl, scene);
  const backend = { id: 'engine', scene, ...draw } as unknown as RenderBackend;
  const notices = createWorldNotices();
  const refused = noticeEffectRefusal(notices);
  const compose = createFrameComposer(context.gl, camera, {
    effects: { chain, shown: () => true, refused },
  });
  return {
    frame() {
      const passes = context.of('drawArrays').length,
        submitted = context.of('drawElements').length;
      draw.render(camera);
      compose(backend, null);
      return {
        chained: context.of('drawArrays').length > passes,
        submitted: context.of('drawElements').length - submitted,
      };
    },
    close: notices.close,
  };
}

/** The kinds of every world notice said while `run` draws `view`, once delivered. */
async function heard(view: ReturnType<typeof session>, run: () => void) {
  const said: string[] = [];
  const stop = listenWorldNotices((notice) => void said.push(notice.phase));
  run();
  await new Promise(setImmediate);
  view.close();
  stop();
  return said;
}

const MODES = [
  ['multiply', HOST_BLENDING_MULTIPLY],
  ['subtractive', HOST_BLENDING_SUBTRACTIVE],
] as const;

for (const [name, blending] of MODES) {
  test(`a pass added while a ${name} surface is drawn: every frame drawn, said once`, async () => {
    const scene = new GraphScene().add(mesh(new GraphSurface('standard')), mesh(blended(blending)));
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
    const scene = new GraphScene().add(mesh(new GraphSurface('standard')));
    const view = session(scene, new EffectChain().add(effect.bloom()));
    const glass = mesh(blended(blending));
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
      new GraphScene().add(mesh(surface)),
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
    const scene = new GraphScene().add(mesh(blended(blending)));
    const view = session(scene, new EffectChain().add(effect.bloom()));
    const said = await heard(view, () => {
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 }, 'its first frame drawn');
      assert.deepEqual(view.frame(), { chained: false, submitted: 1 });
    });
    assert.deepEqual(said, ['effects-refused-blending']);
  });
}
