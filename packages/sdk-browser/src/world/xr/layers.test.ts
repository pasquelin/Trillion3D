import test from 'node:test';
import assert from 'node:assert/strict';
import { createXrLayers } from './layers.ts';
import { XrSessionEmulator, xrFrame } from './session.fixture.ts';

test('composition layers upload only dirty images or compositor redraws and release ownership once', () => {
  const session = new XrSessionEmulator(),
    projection = {};
  let uploads = 0,
    destroyed = 0;
  const native = { needsRedraw: true, destroy: () => destroyed++ };
  const gl = {
    RGBA: 0x1908,
    TEXTURE_2D: 0x0de1,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_BINDING_2D: 0x8069,
    getParameter: () => null,
    bindTexture() {},
    pixelStorei() {},
    texSubImage2D: () => uploads++,
  } as unknown as WebGL2RenderingContext;
  const layers = createXrLayers(
    session,
    projection,
    {
      createQuadLayer: () => native,
      getSubImage: () => ({
        colorTexture: {} as WebGLTexture,
        viewport: { x: 0, y: 0, width: 16, height: 8 },
      }),
    },
    undefined,
    gl,
  );
  const layer = layers.create('quad', {
    space: session.space,
    viewPixelWidth: 16,
    viewPixelHeight: 8,
  });
  const frame = xrFrame(session);
  layers.frame(frame);
  assert.equal(uploads, 0);
  layer.update({} as ImageBitmap);
  layers.frame(frame);
  native.needsRedraw = false;
  layers.frame(frame);
  assert.equal(uploads, 1);
  native.needsRedraw = true;
  layers.frame(frame);
  assert.equal(uploads, 2);
  layer.dispose();
  layer.dispose();
  layers.dispose();
  assert.equal(destroyed, 1);
  assert.throws(() => layer.update({} as ImageBitmap), /XR_LAYER_RELEASED/);
  assert.throws(
    () => layers.create('quad', { space: session.space, viewPixelWidth: 1, viewPixelHeight: 1 }),
    /XR_SESSION_ENDED/,
  );
});

test('updating a static layer replaces it and waits for the next XR frame before upload', () => {
  const session = new XrSessionEmulator();
  const native: { needsRedraw: boolean; destroyed: number; destroy(): void }[] = [];
  const uploaded: object[] = [];
  const binding = {
    createQuadLayer() {
      const layer = {
        needsRedraw: true,
        destroyed: 0,
        destroy() {
          this.destroyed++;
        },
      };
      native.push(layer);
      return layer;
    },
    getSubImage(layer: { needsRedraw?: boolean }) {
      assert.equal(layer.needsRedraw, true, 'the browser refuses writes to a settled static layer');
      uploaded.push(layer);
      return { colorTexture: {} as WebGLTexture, viewport: { x: 0, y: 0, width: 1, height: 1 } };
    },
  };
  const gl = {
    RGBA: 1,
    getParameter: () => null,
    bindTexture() {},
    pixelStorei() {},
    texSubImage2D() {},
  } as unknown as WebGL2RenderingContext;
  const layers = createXrLayers(session, {}, binding, undefined, gl);
  const layer = layers.create('quad', {
    space: session.space,
    viewPixelWidth: 1,
    viewPixelHeight: 1,
  });
  layer.update({} as ImageBitmap);
  layers.frame(xrFrame(session));
  native[0].needsRedraw = false;
  layer.update({} as ImageBitmap);
  layers.frame(xrFrame(session));
  assert.equal(native.length, 2);
  assert.equal(native[0].destroyed, 0, 'the current frame still references the old layer');
  assert.deepEqual(uploaded, [native[0]], 'replacement is not yet in this frame’s render state');
  layers.frame(xrFrame(session));
  assert.deepEqual(uploaded, native);
  assert.equal(native[0].destroyed, 1);
  layer.dispose();
  assert.equal(native[1].destroyed, 0);
  layers.frame(xrFrame(session));
  assert.equal(native[1].destroyed, 1);
});

test('layer replacement snapshots its options and rolls back a rejected render-state update', () => {
  const session = new XrSessionEmulator();
  let reject = false;
  const published = session.updateRenderState.bind(session);
  session.updateRenderState = (state) => {
    if (reject) throw new Error('state refused');
    published(state);
  };
  const native: { needsRedraw: boolean; destroy(): void }[] = [],
    destroyed: object[] = [];
  const dimensions: unknown[] = [];
  const binding = {
    createQuadLayer(options: Record<string, unknown>) {
      dimensions.push([options.viewPixelWidth, options.viewPixelHeight]);
      const layer = {
        needsRedraw: false,
        destroy() {
          destroyed.push(layer);
        },
      };
      native.push(layer);
      return layer;
    },
    getSubImage: () => {
      throw new Error('settled layers cannot be uploaded');
    },
  };
  const layers = createXrLayers(session, {}, binding, undefined, {
    RGBA: 1,
  } as unknown as WebGL2RenderingContext);
  const options = { space: session.space, viewPixelWidth: 16, viewPixelHeight: 8 };
  const handle = layers.create('quad', options);
  options.viewPixelWidth = 32;
  handle.update({} as ImageBitmap);
  reject = true;
  assert.throws(() => layers.frame(xrFrame(session)), /state refused/);
  assert.deepEqual(destroyed, [native[1]], 'only the rejected replacement was destroyed');
  assert.deepEqual((session.renderState as { layers: unknown[] }).layers.slice(1), [native[0]]);
  assert.throws(() => handle.dispose(), /state refused/);
  assert.deepEqual(destroyed, [native[1]], 'failed removal keeps the active native layer');
  reject = false;
  layers.frame(xrFrame(session));
  assert.deepEqual(
    dimensions,
    [
      [16, 8],
      [16, 8],
      [16, 8],
    ],
    'caller mutation cannot change a later replacement',
  );
  layers.dispose();
  assert.equal(new Set(destroyed).size, 3);
  assert.equal(destroyed.length, 3, 'active and retired layers each release once at session end');
});
