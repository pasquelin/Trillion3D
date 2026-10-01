import test from 'node:test';
import assert from 'node:assert/strict';
import { openXrGlBinding } from './glBinding.ts';
import { XrSessionEmulator, xrFrame } from './session.fixture.ts';

test('GL projection borrows browser textures only during a frame and releases its own framebuffer', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'XRWebGLBinding');
  let destroyed = 0,
    deleted = 0,
    attached: unknown;
  const texture = {},
    framebuffer = {};
  class Binding {
    createProjectionLayer(options: Record<string, unknown>) {
      assert.equal(options.depthFormat, 0);
      assert.equal(options.scaleFactor, 1);
      return { destroy: () => destroyed++ };
    }
    getViewSubImage() {
      return { colorTexture: texture, viewport: { x: 0, y: 0, width: 2000, height: 1000 } };
    }
  }
  Object.defineProperty(globalThis, 'XRWebGLBinding', { value: Binding, configurable: true });
  const gl = {
    makeXRCompatible: async () => {},
    createFramebuffer: () => framebuffer,
    getParameter: () => null,
    bindFramebuffer() {},
    framebufferTexture2D(_target: number, _attachment: number, _kind: number, value: unknown) {
      attached = value;
    },
    deleteFramebuffer(value: unknown) {
      assert.equal(value, framebuffer);
      deleted++;
    },
  } as unknown as WebGL2RenderingContext;
  const session = Object.assign(new XrSessionEmulator(), { enabledFeatures: ['layers'] });
  try {
    const binding = await openXrGlBinding(session, gl);
    assert.deepEqual(
      binding.gl.getViewport(xrFrame(session).getViewerPose(session.space)!.views[0]),
      { x: 0, y: 0, width: 2000, height: 1000 },
    );
    assert.equal(attached, texture);
    binding.endFrame?.();
    assert.equal(attached, null, 'opaque browser texture cannot remain attached after callback');
    assert.equal(deleted, 0);
    binding.dispose();
    assert.equal(deleted, 1);
    assert.equal(destroyed, 1);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'XRWebGLBinding', prior);
    else Reflect.deleteProperty(globalThis, 'XRWebGLBinding');
  }
});
