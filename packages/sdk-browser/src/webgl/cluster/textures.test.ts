// #360, #361: the WebGL2 binder uploads a texture again at every version it moves to — nothing
// tells pixels written in place from a sampler change —, its sampler with it, and grants
// anisotropy as the WebGPU path and the Three witness do: to a linear magnification over a chain
// mixed across levels, or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterTextures } from './textures.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';

const ANISOTROPY = 0x84fe;

/** A WebGL2 context that records uploads and anisotropy writes. */
function context() {
  const calls = { uploads: 0, anisotropy: [] as number[], parameters: 0 };
  const gl = new Proxy(
    {
      getExtension: () => ({
        TEXTURE_MAX_ANISOTROPY_EXT: ANISOTROPY,
        MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
      }),
      getParameter: () => 16,
      createTexture: () => ({}),
      texImage2D: () => void calls.uploads++,
      texParameteri: () => void calls.parameters++,
      texParameterf: (_target: number, name: number, value: number) => {
        if (name === ANISOTROPY) calls.anisotropy.push(value);
      },
    } as Record<string, unknown>,
    { get: (target, key) => target[key as string] ?? (typeof key === 'string' ? noop : undefined) },
  );
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}
const noop = () => {};

const record = (fields: Partial<Texture> = {}) =>
  ({
    id: 'map',
    version: 1,
    image: { data: new Uint8Array(4), width: 1, height: 1 },
    wrapS: 'clamp',
    wrapT: 'clamp',
    magFilter: 'linear',
    minFilter: 'linear-mip-linear',
    anisotropy: 1,
    flipY: false,
    premultiplyAlpha: false,
    generateMipmaps: true,
    colorSpace: 'srgb',
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...fields,
  }) as Texture & { version: number };

test('every version uploads the texture again, its sampler with it', () => {
  const { gl, calls } = context();
  const binder = new WebglClusterTextures(gl);
  const map = record();
  binder.bind(0, map);
  binder.bind(0, map);
  assert.equal(calls.uploads, 1, 'the same version: held');
  Object.assign(map, { version: 2, wrapS: 'repeat', anisotropy: 8 });
  binder.bind(0, map);
  assert.equal(calls.uploads, 2, 'a sampler change uploads the picture again');
  assert.deepEqual(calls.anisotropy, [8], 'the sampler set on the new upload');
  (map.image as { data: Uint8Array }).data[0] = 255;
  map.version = 3;
  binder.bind(0, map);
  assert.equal(calls.uploads, 3, 'pixels written in place: uploaded');
});

test('anisotropy is granted only to a linear magnification mixed across levels', () => {
  for (const [fields, granted] of [
    [{ minFilter: 'nearest-mip-linear' }, [8]],
    [{ magFilter: 'nearest' }, []],
    [{ minFilter: 'linear-mip-nearest' }, []],
    [{ minFilter: 'linear' }, []],
  ] as const) {
    const { gl, calls } = context();
    new WebglClusterTextures(gl).bind(0, record({ ...fields, anisotropy: 8 }));
    assert.deepEqual(calls.anisotropy, granted, JSON.stringify(fields));
  }
});

// #360, #361: the UV placement is outside the version — the material binding uploads it at every
// draw —, so moving it alone uploads nothing.
test('a placement moved without a version uploads nothing', () => {
  const { gl, calls } = context();
  const binder = new WebglClusterTextures(gl);
  const map = record();
  binder.bind(0, map);
  Object.assign(map, { transform: [2, 0, 0, 0, 2, 0, 0.5, 0, 1] });
  binder.bind(0, map);
  assert.equal(calls.uploads, 1);
});
