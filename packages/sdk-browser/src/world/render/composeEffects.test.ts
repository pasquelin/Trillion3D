// The effect chain on the WebGL2 composition (#349): an empty chain changes not one call of the
// frame; a chain with a bloom has the engine draw linear radiance into its target, runs the
// passes and the display chain, keeps the result, and a held frame puts it back with no pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { HostDrawOutput, RenderBackend } from '../../backend/types.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { bloomLevelBytes, bloomLevelSizes } from '../../effects/bloomFilter.ts';
import { createFrameComposer } from './compose.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';

const camera = G.perspectiveCamera();
/** A context that renders half floats, as every desktop WebGL2 does. */
const halfFloats = {
  getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
};

function engine(held = false) {
  const outputs: HostDrawOutput[] = [];
  const backend = {
    id: 'engine',
    scene: { background: { isColor: true, r: 0.5, g: 0, b: 1 } },
    frameHeld: held,
    drawHostGeometry: (_camera: unknown, output: HostDrawOutput) => outputs.push({ ...output }),
  } as unknown as RenderBackend;
  return { backend, outputs };
}

function composer(chain?: EffectChain, shown = () => true) {
  const context = createTestContext({ answers: halfFloats });
  const compose = createFrameComposer(context.gl, camera, chain && { chain, shown });
  return { ...context, compose };
}

test('an empty chain composes the frame call for call as no chain does', () => {
  const plain = composer(),
    empty = composer(new EffectChain());
  const a = engine(),
    b = engine();
  plain.compose(a.backend, null);
  empty.compose(b.backend, null);
  assert.deepEqual(empty.calls, plain.calls, 'no pass, no copy, no target');
  assert.deepEqual(b.outputs, a.outputs);
  assert.equal(b.outputs[0].linear, false);
  assert.equal(empty.compose.effectBytes(), 0);
});

test('a bloom: linear radiance into the chain, 2 × levels passes, the display chain, kept once', () => {
  const chain = new EffectChain().add(effect.bloom());
  const { compose, of, names } = composer(chain);
  const { backend, outputs } = engine(true);
  compose(backend, null);
  const levels = bloomLevelSizes(8, 4).length;
  assert.equal(outputs[0].linear, true);
  assert.notEqual(outputs[0].framebuffer, null, 'the engine draws into the linear target');
  assert.deepEqual(of('clearColor')[0], [0, 0, 0, 0], 'over transparent black: alpha is coverage');
  assert.equal(of('drawArrays').length, 2 * levels + 1, 'the bloom, then the display chain');
  assert.equal(names().lastIndexOf('drawArrays') < names().lastIndexOf('blitFramebuffer'), true);
  assert.deepEqual(
    of('texImage2D').map((args) => args[2]),
    ['RGBA16F', 'RGBA16F', 'RGBA16F', 'RGBA16F', 'RGBA8'],
    'the scene, one pass target and two levels in half floats, then the kept frame',
  );
  assert.equal(compose.effectBytes(), 8 * 4 * (8 + 4 + 8) + bloomLevelBytes(8, 4));
  const draws = of('drawArrays').length,
    targets = of('texImage2D').length;
  compose(backend, null);
  assert.equal(outputs.length, 1, 'the held frame drew nothing');
  assert.equal(of('drawArrays').length, draws, 'and ran no pass');
  assert.equal(of('texImage2D').length, targets, 'the targets are fixed');
  (chain.passes[0] as ReturnType<typeof effect.bloom>).intensity = 0.5;
  compose(backend, null);
  assert.equal(outputs.length, 2, 'a changed chain is drawn again, held frame or not');
  assert.equal(of('texImage2D').length, targets, 'on the same targets');
});

test('an emptied chain gives its targets back and draws as before', () => {
  const bloom = effect.bloom(),
    chain = new EffectChain().add(bloom);
  const { compose, of } = composer(chain);
  const { backend, outputs } = engine();
  compose(backend, null);
  chain.remove(bloom);
  compose(backend, null);
  assert.equal(outputs[1].linear, false);
  assert.equal(compose.effectBytes(), 0);
  assert.equal(of('deleteTexture').length, 4, 'every target of the chain');
});

test('a diagnostic view, a capture and a context without half floats show the image alone', () => {
  const chain = new EffectChain().add(effect.bloom());
  let shown = false;
  const diagnostic = composer(chain, () => shown);
  const { backend, outputs } = engine();
  diagnostic.compose(backend, null);
  shown = true;
  diagnostic.compose(backend, null, false, false);
  const bare = createTestContext();
  createFrameComposer(bare.gl, camera, { chain, shown: () => true })(backend, null);
  assert.deepEqual(
    outputs.map((output) => output.linear),
    [false, false, false],
  );
});
