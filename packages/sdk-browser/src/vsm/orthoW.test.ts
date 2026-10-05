// The marking of a sun's page leaves out the divide by w (`markingWgsl.ts`, `vsmMarkPage`): every
// clipmap level's shifted-to-UV matrix has the w row (0, 0, 0, 1), exactly, as uploaded
// in f32, so w = 0·x + 0·y + 0·z + 1 = 1 for a finite point and xyz / w are xyz, bit for bit; a
// point that is not finite has w NaN either way, which the overlap test rejects. A lamp's
// perspective projection keeps its divide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { VsmCacheManager } from './cacheManager.ts';
import { createVsmClipmap } from './clipmap.ts';
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts';
import { createVsmResources, vsmLayout } from './resources.ts';
import { encodeVirtualShadowProjection } from './projectionPass.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { orthographicProjection } from '../../../sdk-core/src/math/primitives/camera.ts';

const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0];
const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test("every clipmap level's UV matrix has the w row (0, 0, 0, 1), exactly in f32", () => {
  let levels = 0;
  for (const direction of [
    [0.3, -0.9, 0.2],
    [0, -1, 0],
    [0.577, -0.577, 0.577],
    [-0.01, -0.2, 0.98],
  ])
    for (const eye of [
      [0, 2, 0],
      [1234.5, 87.25, -9876.125],
      [-3e4, 500, 2e4],
    ]) {
      const clipmap = createVsmClipmap(
        new VsmCacheManager(),
        { id: 'sun', direction },
        { view: VIEW, projection: PROJECTION, perspective: true, eye },
        { width: 1024, height: 1024 },
        0,
      );
      for (const { projectionData } of clipmap.cacheEntry.mapCaches) {
        const m = Float32Array.from(projectionData.shiftedToMapUv);
        assert.deepEqual([m[3], m[7], m[11], m[15]].map(Math.abs), [0, 0, 0, 1]);
        levels++;
      }
    }
  assert.ok(levels >= 12 * 17, `${levels} levels`);
});

test('only the sun marks without the divide: a lamp keeps it', () => {
  const code = vsmPixelPageMarkingWgsl(vsmLayout({ fullMapCapacity: 63 }, 128 * 1024 * 1024));
  assert.match(
    functionText(code, 'vsmMarkPage'),
    /if\(!ortho\)\{mapUvz=vec4f\(mapUvz\.xyz\/mapUvz\.w,mapUvz\.w\);\}/,
  );
  assert.match(functionText(code, 'vsmMarkPageDirectional'), /marginOffset,true\);/);
  assert.match(functionText(code, 'vsmMarkPageLocal'), /marginOffset,false\);/);
});

test('the camera kind decides the projection path: an orthographic matrix scaled ×0.25 stays one', () => {
  // A homogeneous matrix scaled is the same projection; its M[3][3] is 0.25 then, under the old
  // threshold's 0.5. The view uniform's isOrtho word (u32 71) follows the camera's kind alone.
  const ortho = orthographicProjection(new Float64Array(16), -10, 10, -10, 10, 0.1, 100);
  const scaled = ortho.map((v) => v * 0.25);
  // The view uniform the projection pass uploads for its dispatch, read back from the queue.
  const word = (perspective: boolean) => {
    const { device, writes } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } });
    const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 });
    const view = {} as GPUTextureView;
    // The passes' recorded commands are not read: only the upload.
    const pass = new Proxy({}, { get: () => () => {} });
    const encoder = { beginComputePass: () => pass } as unknown as GPUCommandEncoder;
    encodeVirtualShadowProjection(
      encoder,
      res,
      {
        device,
        depth: view,
        normalRough: view,
        flags: view,
        mask: view,
        maskTiles: view,
        width: 64,
        height: 64,
        frameIndex: 0,
        camera: { view: VIEW, projection: scaled, perspective },
      },
      [],
    );
    const write = writes.find(
      (w) => (w.buffer as { label?: string }).label === 'vsm.projection.view',
    )!;
    const bytes = write.data as Uint8Array;
    return new Uint32Array(bytes.buffer, bytes.byteOffset, 72)[71];
  };
  assert.equal(word(false), 1, 'orthographic');
  assert.equal(word(true), 0, 'perspective');
  const level = (perspective: boolean) =>
    createVsmClipmap(
      new VsmCacheManager(),
      { id: 'sun', direction: [0, -1, 0] },
      { view: VIEW, projection: scaled, perspective, eye: [0, 0, 0] },
      { width: 64, height: 64 },
      0,
    ).cacheEntry.mapCaches[0].projectionData.shiftedToMapUv;
  assert.notDeepEqual(level(false), level(true), 'the clipmap sizes its levels by the kind');
});
