// #1410: the bounce probes and surface cache left their storage buffers for float atlases, so the
// deferred lighting with bounce holds the eight storage buffers WebGPU guarantees. Defects these
// tests catch: two probe vectors written to one texel (a probe then reads its neighbour's
// coefficients), an atlas that drops the last entries or outgrows the 2D texture limit, a value
// that does not come back bit for bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNCE_SETTINGS, createBounceCascades } from '../../../sdk-core/src/index.ts';
import { ownedProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts';
import { shaderRun, type Vec } from '../texture/shaderRun.fixture.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { PORTABLE_TEXTURE_SIDE as ATLAS_DIMENSION } from '../frame/referenceTilePlacement.ts';
import { PROBE_TEXELS, atlasBytes, atlasExtent, probeAtlasExtent } from './atlas.ts';
import { bounceProbeBytes, ensureBounceFits } from './limits.ts';
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts';

/** A simulated atlas: `textureDimensions`, `textureLoad` and `textureStore` over a texel map. A
 *  WGSL `u32` division truncates; the run is in doubles, so the layer is truncated here. */
function atlas([width, height, layers]: number[]) {
  const texels = new Map<string, Vec>();
  const key = ([x, y]: Vec, layer: number) => {
    assert.ok(
      Number(x) < width && Number(y) < height && Math.trunc(layer) < layers,
      'in the atlas',
    );
    return `${x},${y},${Math.trunc(layer)}`;
  };
  const scope = {
    probes: {},
    probesOut: {},
    textureDimensions: () => [width, height],
    textureLoad: (_: object, at: Vec, layer: number) => texels.get(key(at, layer)) ?? [0, 0, 0, 0],
    textureStore: (_: object, at: Vec, layer: number, value: Vec) =>
      void texels.set(key(at, layer), value),
  };
  return { texels, scope };
}
type Probe = { probeAt: (i: number) => Vec; probeStore: (i: number, value: Vec) => void };

test('every probe vector has a texel of its own, read back bit for bit where it was written', () => {
  const extent = probeAtlasExtent(3, 2);
  const { texels, scope } = atlas(extent);
  const run = shaderRun<Probe>(BOUNCE_PROBE_SHADER, ['probeAt', 'probeStore'], scope);
  const vectors = 2 * 3 ** 3 * PROBE_TEXELS;
  const value = (i: number) => [i, Math.fround(i / 3), -i, Math.fround(Math.PI * i)];
  for (let i = 0; i < vectors; i++) run.probeStore(i, value(i));
  assert.equal(texels.size, vectors, 'no two vectors share a texel');
  for (let i = 0; i < vectors; i++) assert.deepEqual(run.probeAt(i), value(i), `vector ${i}`);
});

test('the probe atlas holds a level per layer and weighs what the buffer did', () => {
  const cascades = createBounceCascades(ownedProxy().bounds);
  const extent = probeAtlasExtent(cascades.size, BOUNCE_SETTINGS.cascadeLevels);
  assert.equal(extent[0] * extent[1], cascades.probesPerLevel * PROBE_TEXELS, 'a level a layer');
  assert.equal(extent[2], BOUNCE_SETTINGS.cascadeLevels);
  assert.equal(atlasBytes(extent), bounceProbeBytes(cascades.reserveCount));
  assert.ok(extent[0] <= ATLAS_DIMENSION && extent[1] <= ATLAS_DIMENSION);
});

test('a surface cache atlas keeps every texel within the 2D limit, and a larger one is refused', () => {
  for (const texels of [1, 2, 8191, 8192, 8193, 2_000_003, ATLAS_DIMENSION ** 2]) {
    const [width, height] = atlasExtent(texels);
    assert.ok(width <= ATLAS_DIMENSION && height <= ATLAS_DIMENSION, `${texels}: within the limit`);
    assert.ok(width * height >= texels, `${texels}: no texel lost`);
    assert.ok(width * height - texels < height, `${texels}: under a texel of padding per row`);
  }
  const { device } = fakeDevice({
    limits: { maxTextureDimension2D: ATLAS_DIMENSION, maxTextureArrayLayers: 256 },
  });
  const proxy = { ...ownedProxy(), triangles: ATLAS_DIMENSION ** 2 / 2 + 1 };
  assert.throws(
    () => ensureBounceFits(device, proxy, [1, 1, 1], 16),
    /bounce atlas "surface cache" needs .* over this device's maxTextureDimension2D of 8192/,
  );
});
