// An engine-owned render target: a colour texture holding a display image and a depth
// renderbuffer, on a framebuffer of the host context, in drawing-buffer pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindWebglTarget, createWebglRenderTarget } from './webglRenderTarget.ts';
import { createTestContext } from './webglTestContext.ts';

test('a target stores bytes as written, unfiltered, and 24-bit depth at the size asked for', () => {
  const { gl, of } = createTestContext();
  const target = createWebglRenderTarget(gl, 8, 4);
  assert.deepEqual(of('texImage2D')[0].slice(2, 5), ['RGBA8', 8, 4]);
  assert.deepEqual(of('renderbufferStorage')[0].slice(1), ['DEPTH_COMPONENT24', 8, 4]);
  assert.equal(of('framebufferTexture2D').length, 1);
  assert.equal(of('framebufferRenderbuffer')[0][1], 'DEPTH_ATTACHMENT');
  assert.deepEqual(
    of('texParameteri')
      .filter((args) => String(args[1]).endsWith('_FILTER'))
      .map((args) => args[2]),
    ['NEAREST', 'NEAREST'],
    'a texel is read as it was written',
  );
  assert.deepEqual([target.width, target.height], [8, 4]);
  assert.equal(of('bindFramebuffer').at(-1)?.[1], null, 'the creation leaves nothing bound');
});

test('an incomplete framebuffer is refused by name', () => {
  const { gl } = createTestContext();
  const broken = new Proxy(gl, {
    get: (target, name: string) =>
      name === 'checkFramebufferStatus'
        ? () => 'FRAMEBUFFER_UNSUPPORTED'
        : Reflect.get(target, name),
  });
  assert.throws(() => createWebglRenderTarget(broken, 2, 2), /RENDER_TARGET_INCOMPLETE/);
});

test('a resize reallocates both attachments once and keeps the same names', () => {
  const { gl, of } = createTestContext();
  const target = createWebglRenderTarget(gl, 8, 4);
  assert.equal(target.resize(8, 4), false, 'the same size allocates nothing');
  assert.equal(target.resize(4, 2), true);
  assert.deepEqual(of('texImage2D').at(-1)?.slice(3, 5), [4, 2]);
  assert.deepEqual(of('renderbufferStorage').at(-1)?.slice(2), [4, 2]);
  assert.equal(of('createTexture').length, 1, 'the texture name survives the resize');
  assert.equal(of('createFramebuffer').length, 1);
  target.dispose();
  assert.deepEqual(
    ['deleteFramebuffer', 'deleteRenderbuffer', 'deleteTexture'].map((name) => of(name).length),
    [1, 1, 1],
  );
});

test('binding a target sets the viewport to it, binding none to the drawing buffer', () => {
  const { gl, of } = createTestContext();
  const target = createWebglRenderTarget(gl, 4, 2);
  bindWebglTarget(gl, target);
  assert.deepEqual(of('bindFramebuffer').at(-1), ['FRAMEBUFFER', target.framebuffer]);
  assert.deepEqual(of('viewport').at(-1), [0, 0, 4, 2]);
  bindWebglTarget(gl, null);
  assert.deepEqual(of('bindFramebuffer').at(-1), ['FRAMEBUFFER', null]);
  assert.deepEqual(of('viewport').at(-1), [0, 0, 8, 4], 'the drawing-buffer size');
});
