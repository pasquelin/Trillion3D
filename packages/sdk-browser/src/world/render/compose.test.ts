// The frame composer: one engine's frame on the surface or a target — bind, present a surface
// the engine drew itself or clear and ask the engine to draw, keep the complete frame, put a
// held one back. What it clears with and what it tells the engine are what the reference's host
// pass did before it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { linearToSrgb } from '../../../../sdk-core/src/index.ts';
import type { HostDrawOutput, RenderBackend } from '../../backend/types.ts';
import { createFrameComposer } from './compose.ts';
import { createWebglRenderTarget } from '../../webgl/core/renderTarget.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import { families } from '../../host/families.ts';
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';

const camera = G.perspectiveCamera();

/** An engine that draws on the host surface, recording what it was told. */
function engine(options: { lit?: boolean; held?: boolean; background?: unknown } = {}) {
  const outputs: HostDrawOutput[] = [];
  const backend = {
    id: 'engine',
    scene: { background: options.background ?? { isColor: true, r: 0.5, g: 0, b: 1 } },
    sceneLit: options.lit === undefined ? undefined : () => options.lit,
    frameHeld: options.held ?? false,
    drawHostGeometry: (_camera: unknown, output: HostDrawOutput) => outputs.push({ ...output }),
  } as unknown as RenderBackend;
  return { backend, outputs };
}

test('a complete frame on the surface: bound, cleared with the encoded background, drawn, kept', () => {
  const { gl, of, names } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const { backend, outputs } = engine();
  compose(backend, null);
  assert.deepEqual(of('bindFramebuffer')[0], ['FRAMEBUFFER', null]);
  assert.deepEqual(of('viewport')[0], [0, 0, 8, 4], 'the drawing buffer, whole');
  assert.deepEqual(
    of('clearColor')[0],
    [linearToSrgb(0.5), linearToSrgb(0), linearToSrgb(1), 1],
    'sRGB-encoded',
  );
  assert.equal(of('clear').length, 1, 'colour, depth and stencil in one clear');
  assert.deepEqual(of('clearDepth')[0], [1]);
  assert.deepEqual(of('clearStencil')[0], [0]);
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], {
    toneMapped: true,
    toneMapping: 'aces',
    framebuffer: null,
    width: 8,
    height: 4,
    linear: false,
  });
  assert.equal(of('blitFramebuffer').length, 1, 'the complete frame is kept');
  assert.ok(names().indexOf('clear') < names().indexOf('blitFramebuffer'));
});

test('an unlit scene composes by identity; a lit one takes the filmic curve', () => {
  const { gl } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const unlit = engine({ lit: false }),
    lit = engine({ lit: true });
  compose(unlit.backend, null);
  compose(lit.backend, null);
  assert.equal(unlit.outputs[0].toneMapped, false);
  assert.equal(lit.outputs[0].toneMapped, true);
});

test('a target is bound, drawn at its size, and never kept', () => {
  const { gl, of } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const target = createWebglRenderTarget(gl, 4, 2);
  const { backend, outputs } = engine({ held: true });
  compose(backend, target);
  assert.deepEqual(of('bindFramebuffer').at(-1), ['FRAMEBUFFER', target.framebuffer]);
  assert.deepEqual(outputs[0], {
    toneMapped: true,
    toneMapping: 'aces',
    framebuffer: target.framebuffer,
    width: 4,
    height: 2,
    linear: false,
  });
  assert.equal(of('blitFramebuffer').length, 0, 'a target holds no held frame');
});

test('a held frame is put back in one copy; a fallback draws instead of reusing it', () => {
  const { gl, of } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const { backend, outputs } = engine({ held: true });
  compose(backend, null);
  compose(backend, null);
  assert.equal(outputs.length, 1, 'the held frame drew nothing');
  assert.equal(of('blitFramebuffer').length, 2, 'kept once, put back once');
  compose(backend, null, false);
  assert.equal(outputs.length, 2, 'without reuse the engine draws, and the frame is kept again');
  assert.equal(of('blitFramebuffer').length, 3);
});

test('a presented surface is copied where the frame lands, and the engine is not asked to draw', () => {
  const { gl, of, names } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const { backend, outputs } = engine();
  (backend as { presentedSurface?: HTMLCanvasElement }).presentedSurface = {
    width: 8,
    height: 4,
  } as HTMLCanvasElement;
  const target = createWebglRenderTarget(gl, 8, 4);
  compose(backend, target);
  assert.deepEqual(of('bindFramebuffer').at(-1), ['FRAMEBUFFER', target.framebuffer]);
  assert.ok(names().includes('drawArrays'), 'the copy was drawn');
  assert.equal(outputs.length, 0);
  assert.equal(of('clear').length, 0, 'nothing to clear under a whole-surface copy');
});

test('an engine that draws nothing on the host surface is refused by name', () => {
  const { gl } = createTestContext();
  const compose = createFrameComposer(gl, camera);
  const backend = { id: 'mute', scene: {} } as unknown as RenderBackend;
  assert.throws(() => compose(backend, null), /HOST_DRAW_UNSUPPORTED:mute/);
});

/** The particles' code, which the frame that draws a pool waits for (`familyUse.ts`), arrived. */
const particleCodeArrived = () => families.particles.load();

test('WebGL2 steps the pools ahead of the engine, which draws an image they moved in', async () => {
  await particleCodeArrived();
  const { gl, calls, names } = createTestContext({ answers: { getExtension: () => ({}) } });
  const [pool, pools] = [new ParticlePool({ capacity: 8 }), [] as ParticlePool[]];
  pools.push(pool);
  const compose = createFrameComposer(gl, camera, { particles: pools });
  const { backend, outputs } = engine({ held: true });
  compose(backend, null);
  compose(backend, null);
  assert.equal(outputs.length, 1, 'an idle pool: the kept frame is put back');
  assert.equal(compose.effectBytes(), 0, 'no particle drawn: no depth copy counted');
  pool.emit(0, 0, 0, 0, 1, 0, 2);
  compose(backend, null);
  assert.equal(outputs.length, 2, 'a moving one: the engine draws');
  assert.equal(compose.effectBytes(), 8 * 4 * 4, "the 8 × 4 frame's depth copy, 4 bytes a texel");
  const drawn = names().lastIndexOf('drawArrays');
  assert.ok(drawn >= 0 && drawn < names().lastIndexOf('clear'), 'the step first');
  const bound = calls.slice(drawn).find((call) => call.name === 'viewport')?.args;
  assert.deepEqual(bound, [0, 0, 8, 4], 'then the page, bound again');
  assert.ok(names().lastIndexOf('drawArraysInstanced') > drawn, 'then the pool over the image');
  pools.length = 0;
  compose(backend, null);
  assert.equal(outputs.length, 3, 'a pool let go: its particles never put back');
});

test('a WebGL2 refusal is heard once by name, and the session draws on without the pools', async () => {
  await particleCodeArrived();
  const cases = [
    [{ getExtension: () => null }, 'render 32-bit floats'],
    [{ getExtension: () => ({}), getError: () => 'INVALID_OPERATION' }, 'depth it cannot copy'],
  ] as const;
  for (const [answers, why] of cases) {
    const { gl, names, of } = createTestContext({ answers });
    const [pool, heard] = [new ParticlePool({ capacity: 8 }), [] as string[]];
    const particlesRefused = (reason: string) => void heard.push(reason);
    const effects = { chain: new EffectChain().add(effect.bloom()), shown: () => true },
      layers = { effects, particles: [pool], particlesRefused };
    const compose = createFrameComposer(gl, camera, layers);
    const { backend, outputs } = engine();
    pool.emit(0, 0, -2, 0, 1, 0, 2);
    [0, 1].forEach(() => compose(backend, null)); // nothing thrown, the frame finished
    pool.emit(0, 0, -2, 0, 1, 0, 2);
    assert.deepEqual([outputs.length, pool.refused, heard.length], [2, true, 1], why);
    assert.match(heard[0], new RegExp(`^PARTICLES_UNSUPPORTED: .*${why}`));
    assert.ok(!names().includes('drawArraysInstanced'), 'never drawn hard-edged');
    assert.equal(of('bindFramebuffer').at(-1)?.[1], null, 'on the page, nothing left open');
  }
});
