import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadXrGlLayer } from './glLayerUpload.ts';

test('XR layer uploads premultiply and flip pixels, restoring unpack state even on upload failure', () => {
  const texture = {},
    previous = {};
  const state = new Map<number, unknown>([
    [1, previous],
    [2, false],
    [3, false],
  ]);
  let fail = false,
    uploads = 0;
  const gl = {
    TEXTURE_BINDING_2D: 1,
    UNPACK_FLIP_Y_WEBGL: 2,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 3,
    getParameter: (key: number) => state.get(key),
    pixelStorei: (key: number, value: unknown) => state.set(key, value),
    bindTexture: (_key: number, value: unknown) => state.set(1, value),
    texSubImage2D() {
      assert.equal(state.get(1), texture);
      assert.equal(state.get(2), true);
      assert.equal(state.get(3), true);
      uploads++;
      if (fail) throw new Error('upload refused');
    },
  } as unknown as WebGL2RenderingContext;
  const upload = () =>
    uploadXrGlLayer(gl, texture, {} as HTMLCanvasElement, { x: 0, y: 0, width: 2, height: 2 });
  upload();
  fail = true;
  assert.throws(upload, /upload refused/);
  assert.equal(uploads, 2);
  assert.deepEqual(
    [...state],
    [
      [1, previous],
      [2, false],
      [3, false],
    ],
  );
});
