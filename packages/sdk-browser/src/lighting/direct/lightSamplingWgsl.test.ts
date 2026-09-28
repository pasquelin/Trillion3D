import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DIRECT_LIGHT_SAMPLING_WGSL, SAMPLED_RANKS } from './lightSamplingWgsl.ts';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './lightingWgsl.ts';
import { BOUNCE_LIGHTING_SHADER, DIRECT_LIGHTING_SHADER } from '../deferred/shaders.ts';
import { HASH_UNIT_WGSL } from '../../math/hashUnitWgsl.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { LIGHT_TILES_SHADER } from '../tiles/shader.ts';
import {
  compactTile,
  tileLayout,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('deferred resolve samples on a ranked image and walks every light at rank zero', () => {
  // The branch, in the resolve alone: rank zero is the loop from before the batch, unchanged.
  assert.match(
    DIRECT_LIGHTING_WGSL,
    /let rank=u32\(view\.viewport\.w\);\s*if\(rank==0u\)\{return tileLighting\(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE\);\}\s*return sampledTileLighting\(/,
  );
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.equal(occurrences(shader, DIRECT_LIGHT_SAMPLING_WGSL), 1);
    assert.equal(occurrences(shader, HASH_UNIT_WGSL), 1, 'one hash, defined once');
  }
  // The blend pass shades its lights in full: a forward surface has no history to average.
  assert.equal(occurrences(declaredLightingWgsl(11, 18, 26), 'sampledTileLighting'), 0);
});

test('the sample budget is the published setting, and a list within it is summed in full', () => {
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    new RegExp(`const LIGHT_SAMPLES:u32=${LIGHT_SETTINGS.samplesPerPixel}u;`),
  );
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    /if\(kept<=LIGHT_SAMPLES\|\|kept>TILE_LIGHTS\)\{return tileLighting\(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE\);\}/,
  );
  // A light worth a sample's share is shaded exactly and leaves the pool; the drawn ones are
  // divided by their probability, copies counted.
  assert.match(DIRECT_LIGHT_SAMPLING_WGSL, /if\(weight\*f32\(LIGHT_SAMPLES\)>=total\)/);
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    /factor=pool\/\(f32\(samples\)\*lightWeight\(light,N,P\)\);/,
  );
  // The offset depends on the pixel and the bounded rank only: a replayed image is the same image.
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    /fract\(hashUnit\(u32\(pixel\.y\)\*65536u\+u32\(pixel\.x\)\)\+f32\(rank\)\*GOLDEN_RATIO\)/,
  );
  assert.ok(SAMPLED_RANKS * 0.61803399 < 2 ** 10, 'the rank keeps the fraction its precision');
});

test('one loop shades the lights of a pixel in full: its list, its pool slice or the scene (#822, #849)', () => {
  // The sampled weights are recomputed where read (#924): no private array of TILE_LIGHTS weights.
  assert.doesNotMatch(DIRECT_LIGHT_SAMPLING_WGSL, /array<f32,/);
  assert.equal(
    occurrences(DIRECT_LIGHT_SAMPLING_WGSL, 'lightWeight('),
    3,
    'defined once, read by the list and by the factor of a drawn light',
  );
  // One call to the shading in the full loop (\`sliceLighting\`), one in the sampled one: no walk
  // over the scene beside them, the no-tile fallback of the blend pass included.
  assert.equal(occurrences(DIRECT_LIGHTING_WGSL, 'declaredLight(directLights.items['), 1);
  assert.equal(occurrences(declaredLightingWgsl(11, 18, 26), 'declaredLight('), 2);
});

test('a tile more than TILE_LIGHTS lights reach reads exactly those, in order (#849)', () => {
  // The resolve's own tileSlice, run on the record the tile pass's oracle writes.
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const TILE_LIGHTS = layout.tileLights;
  const reached = [...Array(300).keys()].filter((light) => light % 3 !== 1);
  const read = (tileLights: Uint32Array) => {
    const { tileSlice } = shaderFunctions<{
      tileSlice: (base: number, countSlot: number, firstSlot: number) => { x: number; y: number };
    }>(DIRECT_LIGHTING_WGSL, ['tileSlice'], {
      tileLights,
      directLights: { count: 300 },
      TILE_LIGHTS,
      TILE_NO_SLICE: layout.noSlice,
    });
    const slice = tileSlice(0, 0, layout.opaqueBase);
    return slice.x === layout.noSlice
      ? [...Array(slice.y).keys()]
      : [...tileLights.subarray(slice.x, slice.x + slice.y)];
  };
  const tile = (opaque: number[], capacity = 400) =>
    compactTile(layout, { opaque, blend: [] }, 300, undefined, { capacity, head: 0, overflow: 0 });
  assert.deepEqual(read(tile(reached)), reached);
  // Within its list, the list; a pool with no room, every light of the scene.
  assert.deepEqual(read(tile(reached.slice(0, TILE_LIGHTS))), reached.slice(0, TILE_LIGHTS));
  assert.equal(read(tile(reached, 100)).length, 300);
});
