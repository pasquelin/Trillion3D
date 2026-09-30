import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DIRECT_LIGHT_SAMPLING_WGSL, SAMPLED_RANKS } from './lightSamplingWgsl.ts';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './lightingWgsl.ts';
import { BOUNCE_LIGHTING_SHADER, DIRECT_LIGHTING_SHADER } from '../deferred/shaders.ts';
import { HASH_UNIT_WGSL } from '../../math/hashUnitWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { LIGHT_TILES_SHADER } from '../tiles/shader.ts';
import {
  compactTile,
  tileLayout,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('deferred resolve samples a shadowed list on a ranked image and walks every light otherwise', () => {
  // The branch, in the resolve alone: rank zero is the loop from before the batch, unchanged; a
  // moving tile whose list holds no shadowed light reads the tile pass's one-word flag (#1249).
  assert.match(
    DIRECT_LIGHTING_WGSL,
    /let rank=u32\(view\.viewport\.w\);\s*if\(rank==0u\|\|!tileShadowed\(tile,tilesX\)\)\{return clusterLighting\(rgb,metal,rough,N,V,P,ao,pixel\);\}\s*return sampledTileLighting\(/,
  );
  // The flag is one read of the record, never a walk of its lights: no per-pixel loop remains.
  assert.match(
    DIRECT_LIGHTING_WGSL,
    /fn tileShadowed\(tile:vec2u,tilesX:u32\)->bool\{\s*return tileLights\[\(tile\.y\*tilesX\+tile\.x\)\*TILE_STRIDE\+TILE_SHADOW_BASE\]!=0u;\s*\}/,
  );
  assert.doesNotMatch(DIRECT_LIGHTING_WGSL, /listShadowed/);
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.equal(occurrences(shader, DIRECT_LIGHT_SAMPLING_WGSL), 1);
    assert.equal(occurrences(shader, HASH_UNIT_WGSL), 1, 'one hash, defined once');
  }
  // The blend pass shades its lights in full: a forward surface has no history to average.
  assert.equal(occurrences(declaredLightingWgsl(11, 18, 26), 'sampledTileLighting'), 0);
});

test('a moving resolve reads the tile pass flag once, never the list, to choose the sum (#1249)', () => {
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const STRIDE = layout.stride,
    SHADOW = layout.shadowBase;
  // Two tiles one pixel wide: the second tile's flag word decides the branch, alone.
  const run = (flag: number) => {
    const words = new Uint32Array(STRIDE * 2);
    words[0] = 8; // tile 0: a list of 8, between LIGHT_SAMPLES and TILE_LIGHTS
    words[STRIDE] = 8;
    words[STRIDE + SHADOW] = flag;
    const { contractLighting } = shaderFunctions<{
      contractLighting: (...args: unknown[]) => number;
    }>(DIRECT_LIGHTING_WGSL, ['contractLighting', 'tileShadowed', 'pixelTile'], {
      ...wgslConstants(DIRECT_LIGHTING_WGSL),
      view: { lightParams: { x: 2, y: 2, z: 1 }, viewport: { w: 7 } },
      vec3f: () => 0,
      tileLights: words,
      clusterLighting: () => 1,
      sampledTileLighting: () => 2,
    });
    return contractLighting(0, 0, 0, 0, 0, 0, 0, { x: 20.5, y: 0.5 });
  };
  assert.equal(run(0), 1, 'no shadowed light: the exact full sum the still image shows');
  assert.equal(run(1), 2, 'a shadowed light: the drawn resolve, unchanged');
});

test('the tile pass flag marks a list that holds a shadowed light (#1249)', () => {
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const flag = (shadowed: number[]) =>
    compactTile(layout, { opaque: [1, 2, 3], blend: [], shadowed }, 4)[layout.shadowBase];
  assert.equal(flag([2]), 1);
  assert.equal(flag([9]), 0, 'a shadowed light outside the opaque list leaves it clear');
  assert.equal(flag([]), 0);
  assert.equal(compactTile(layout, { opaque: [], blend: [] }, 0)[layout.shadowBase], 0);
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
  // over the scene beside them, the no-tile fallback of the blend pass included. The cluster's
  // slice is one more slice of that loop.
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
