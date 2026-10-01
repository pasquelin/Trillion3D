import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../../../../packages/sdk-browser/src/webgl/core/testContext.fixture.ts';
import { createWebglRipples } from './webgl.ts';

function fixture(supported = true) {
  const requested: string[] = [];
  const context = createTestContext({
    answers: {
      getExtension(name: string) {
        requested.push(name);
        return supported && name === 'EXT_color_buffer_float' ? {} : null;
      },
    },
  });
  return { ...context, requested };
}

test('WebGL ripples draw at most 64 impulse quads with no sample/render texture alias', () => {
  const context = fixture(),
    runtime = createWebglRipples(context.gl, { resolution: 256, rate: 30 });
  const splats = Array.from({ length: 65 }, () => [0, 0, 1, 0.01] as const);
  runtime.step(0, undefined, { camera: [0, 0], splats });
  runtime.step(1 / 30, undefined, { camera: [0.25, 0.25], splats: [] });
  assert.deepEqual(context.of('drawArraysInstanced'), [['TRIANGLES', 0, 6, 64]]);
  assert.equal(context.of('drawArrays').length, 2, 'one recenter and one fixed solve');
  const attachments = new Map<unknown, unknown>();
  let framebuffer: unknown = null,
    sampled: unknown = null;
  for (const { name, args } of context.calls) {
    if (name === 'bindFramebuffer') framebuffer = args[1];
    if (name === 'bindTexture') sampled = args[1];
    if (name === 'framebufferTexture2D') attachments.set(framebuffer, args[3]);
    if (name === 'drawArrays') assert.notEqual(sampled, attachments.get(framebuffer));
    if (name === 'drawArraysInstanced') assert.equal(sampled, null);
  }
  assert.ok(!context.requested.includes('EXT_float_blend'), '32-bit float blending is not needed');
  runtime.dispose();
  runtime.dispose();
  assert.equal(context.of('deleteTexture').length, 2);
});

test('WebGL refusal is explicit without half-float colour targets or after context loss', () => {
  const unsupported = fixture(false);
  assert.throws(
    () => createWebglRipples(unsupported.gl, { resolution: 256, rate: 30 }),
    /unavailable/,
  );
  assert.equal(unsupported.of('createTexture').length, 0);
  const context = fixture(),
    runtime = createWebglRipples(context.gl, { resolution: 256, rate: 30 });
  context.state.lost = true;
  assert.throws(() => runtime.step(1 / 30), /unavailable/);
  runtime.dispose();
});
