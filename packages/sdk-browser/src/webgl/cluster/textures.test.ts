// #360, #361: the WebGL2 binder uploads a texture again at every version it moves to, sets its
// sampler alone when only its sampling moved, and grants anisotropy as the WebGPU path and the
// Three witness do: to a linear magnification over a chain mixed across levels, or not at all.
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
    sampling: 0,
    placement: 0,
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
  }) as Texture & { version: number; sampling: number };

test('a version uploads the texture again, a sampling sets its sampler alone', () => {
  const { gl, calls } = context();
  const binder = new WebglClusterTextures(gl);
  const map = record();
  binder.bind(0, map);
  binder.bind(0, map);
  assert.equal(calls.uploads, 1, 'the same version: held');
  Object.assign(map, { sampling: 1, wrapS: 'repeat', anisotropy: 8 });
  binder.bind(0, map);
  assert.equal(calls.uploads, 1, 'a sampler change uploads nothing');
  assert.deepEqual(calls.anisotropy, [1, 8], 'the sampler set again');
  (map.image as { data: Uint8Array }).data[0] = 255;
  map.version = 2;
  binder.bind(0, map);
  assert.equal(calls.uploads, 2, 'pixels written in place: uploaded');
});

test('anisotropy is granted only to a linear magnification mixed across levels', () => {
  for (const [fields, granted] of [
    [{ minFilter: 'nearest-mip-linear' }, [8]],
    [{ magFilter: 'nearest' }, [1]],
    [{ minFilter: 'linear-mip-nearest' }, [1]],
    [{ minFilter: 'linear' }, [1]],
  ] as const) {
    const { gl, calls } = context();
    new WebglClusterTextures(gl).bind(0, record({ ...fields, anisotropy: 8 }));
    assert.deepEqual(calls.anisotropy, granted, JSON.stringify(fields));
  }
});

// #360, #361: the UV placement is not the binder's — the material binding uploads it at every
// draw —, so moving it alone uploads nothing.
test('a placement moved without a version uploads nothing', () => {
  const { gl, calls } = context();
  const binder = new WebglClusterTextures(gl);
  const map = record();
  binder.bind(0, map);
  Object.assign(map, { placement: 1, transform: [2, 0, 0, 0, 2, 0, 0.5, 0, 1] });
  binder.bind(0, map);
  assert.equal(calls.uploads, 1);
});

// The sampler is written on the ACTIVE unit's texture: a texture already bound on unit 1 while
// unit 0 was active last must select unit 1 before its parameters.
test('a sampler change selects the unit of its texture, already bound or not', () => {
  const { gl } = context();
  let active = -1;
  const onUnit: number[] = [];
  Object.assign(gl, {
    TEXTURE0: 0x84c0,
    activeTexture: (unit: number) => void (active = unit - 0x84c0),
    texParameteri: () => void onUnit.push(active),
  });
  const binder = new WebglClusterTextures(gl);
  const first = record({ id: 'first' }),
    second = record({ id: 'second' });
  binder.bind(1, second);
  binder.bind(0, first);
  onUnit.length = 0;
  Object.assign(second, { sampling: 1, wrapS: 'repeat' });
  binder.bind(1, second);
  assert.ok(onUnit.length > 0, 'the sampler set again');
  assert.ok(
    onUnit.every((unit) => unit === 1),
    `parameters written on units ${onUnit}`,
  );
});
