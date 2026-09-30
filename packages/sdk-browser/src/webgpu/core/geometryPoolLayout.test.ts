// #1410: the float pool's normals and tangents ride in a float atlas (`floatAtlas.ts`), no storage
// buffer, so the lighting with bounce and the shadow demand, which recompute the receiver offset
// from them, hold the eight storage buffers WebGPU guarantees. Defects these tests catch: a normal
// written where the passes do not read it (the offset then leaves another normal than the
// resolve's), a growth that leaves the normals behind, an atlas that weighs more than the buffer
// did (the memory budgets would move), and a pool that holds fewer vertices than develop's three
// buffers did under the same `maxStorageBufferBindingSize`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shaderRun, type Vec } from '../../texture/shaderRun.fixture.ts';
import { normalAtlasWgsl } from '../../visibility/shader/pageWgsl.ts';
import { PORTABLE_TEXTURE_SIDE } from '../../frame/referenceTilePlacement.ts';
import { createVertexPool } from './geometryPool.ts';
import { poolFits, poolFloats } from './geometryPoolLayout.ts';
import { createFloatAtlas, type FloatAtlas } from './floatAtlas.ts';

/** The atlas's row width bound and rows a layer: the portable texture side. */
const FLOAT_ATLAS_ROWS = PORTABLE_TEXTURE_SIDE,
  FLOAT_ATLAS_WIDTH = PORTABLE_TEXTURE_SIDE;
/** Width, rows and layers of the atlas the pool makes for `floats` floats. */
const floatAtlasExtent = (floats: number) =>
  createFloatAtlas(fakeDevice().device, 'extent', floats).extent;
import { uvBufferFloats } from './vertexColors.ts';
import type { HostAttributes } from '../../host/resources.ts';

/** A triangle whose every normal and tangent component differs. */
function triangle() {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute(
    'normal',
    G.floatAttribute([0.1, 0.2, 0.9, 0.3, 0.4, 0.8, 0.5, 0.6, 0.7], 3),
  );
  geometry.setAttribute('tangent', G.floatAttribute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4));
  return geometry.attributes as unknown as HostAttributes;
}
type Vertex = {
  vertN: (base: number, idx: number) => Vec;
  vertT: (base: number, idx: number) => Vec;
};

/** The atlas the texture writes left, as the shared text reads it (`normalAtlasWgsl`). */
function replayAtlas(gpu: ReturnType<typeof fakeDevice>, texture: object, width: number) {
  const texels = new Map<number, number>();
  for (const { destination, data, layout, size } of gpu.texelWrites) {
    if (destination.texture !== texture) continue;
    const [x, y, layer] = destination.origin as number[];
    const [w, h] = size as number[];
    const floats = new Float32Array(data.buffer, data.byteOffset + (layout.offset ?? 0));
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++)
        texels.set(
          (layer * FLOAT_ATLAS_ROWS + y + r) * width + x + c,
          floats[(r * (layout.bytesPerRow ?? 0)) / 4 + c],
        );
  }
  return {
    normals: {},
    textureDimensions: () => [width, FLOAT_ATLAS_ROWS],
    textureLoad: (_: object, [x, y]: Vec, layer: number) => [
      texels.get((Math.trunc(layer) * FLOAT_ATLAS_ROWS + Number(y)) * width + Number(x)) ?? 0,
    ],
  };
}

/** Checks that the shared text reads, at `base`, the triangle's normals and tangents bit for bit. */
function assertNormals(gpu: ReturnType<typeof fakeDevice>, atlas: FloatAtlas, base: number) {
  const scope = replayAtlas(gpu, atlas.texture, atlas.extent[0]);
  const run = shaderRun<Vertex>(normalAtlasWgsl(0), ['normalAt', 'vertN', 'vertT'], scope);
  const host = triangle();
  for (let v = 0; v < 3; v++) {
    const normal = [0, 1, 2].map((c) => Math.fround(host.normal!.getComponent(v, c)));
    const tangent = [0, 1, 2, 3].map((c) => Math.fround(host.tangent!.getComponent(v, c)));
    assert.deepEqual(run.vertN(base, v), normal, `normal ${v} at ${base}, bit for bit`);
    assert.deepEqual(run.vertT(base, v), tangent, `tangent ${v} at ${base}, bit for bit`);
  }
}

test('the passes read, from the normal atlas, the very normals and tangents the pool wrote', () => {
  const gpu = fakeDevice();
  const pool = createVertexPool(gpu.device, 6, false, new Map(), 5);
  pool.place(triangle());
  const block = pool.place(triangle())!;
  assertNormals(gpu, pool.normalAtlas, block.vertexBase);
  assert.equal(pool.concatNrm, pool.normalAtlas.view, 'the passes bind the atlas itself');
});

test('a growth writes every placed normal again into the wider atlas, and frees the narrower', () => {
  const gpu = fakeDevice();
  const pool = createVertexPool(gpu.device, 3, false, new Map(), 5);
  const first = pool.place(triangle())!;
  const before = pool.normalAtlas;
  const second = pool.place(triangle())!; // past the room: the pool doubles
  const after = pool.normalAtlas;
  assert.notEqual(after.texture, before.texture, 'a new atlas');
  for (const block of [first, second]) assertNormals(gpu, after, block.vertexBase);
  assert.ok(gpu.destroyed.includes(before.texture as never), 'the narrower atlas freed');
});

test('the normal atlas weighs the bytes the normal buffer did: the budgets it funds see no change', () => {
  for (const vertices of [1, 3, 1000, 1171, 10_000, 65_536, 4_793_490]) {
    const [width, rows, layers] = floatAtlasExtent(vertices * 7);
    assert.equal(width * rows * layers, vertices * 7, `${vertices} vertices: no padding`);
    assert.ok(width <= FLOAT_ATLAS_WIDTH && rows <= FLOAT_ATLAS_ROWS, `${vertices}: within 2D`);
  }
});

test('under the same maxStorageBufferBindingSize, the pool holds at least the vertices develop held', () => {
  const MiB = 2 ** 20;
  /** Develop's pool (#1410's base): positions and deformation block, UVs, normals, three buffers
   *  each under the storage binding cap. */
  const developHolds = (n: number, tail: number, coloured: boolean, cap: number) =>
    [n * 3 + tail, uvBufferFloats(n, coloured), n * 7].every((floats) => floats * 4 <= cap);
  for (const cap of [128 * MiB, 1024 * MiB, 2 ** 32 - 4])
    for (const tail of [0, 1000, 20 * MiB])
      for (const coloured of [false, true]) {
        const limits = {
          maxStorageBufferBindingSize: cap,
          maxBufferSize: cap,
          maxTextureDimension2D: 8192,
          maxTextureArrayLayers: 256,
        } as GPUSupportedLimits;
        let most = 0;
        for (let step = 2 ** 32; step >= 1; step /= 2)
          if (developHolds(most + step, tail, coloured, cap)) most += step;
        assert.ok(most > 0, 'develop holds some vertices');
        const at = `cap ${cap}, tail ${tail}, coloured ${coloured}: ${most} vertices`;
        assert.ok(poolFits(poolFloats(most, tail, coloured), limits), at);
      }
  // A real pool opened at develop's ceiling for the guaranteed limits.
  const ceiling = Math.floor((128 * MiB) / 28);
  const { device } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 128 * MiB, maxBufferSize: 256 * MiB },
  });
  assert.doesNotThrow(() => createVertexPool(device, ceiling, false, new Map()));
});
