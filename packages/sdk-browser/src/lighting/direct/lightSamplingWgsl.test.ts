import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DIRECT_LIGHT_SAMPLING_WGSL, SAMPLED_RANKS } from './lightSamplingWgsl.ts';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './lightingWgsl.ts';
import { HASH_UNIT_WGSL } from '../../math/hashUnitWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import {
  compactTile,
  tileLayout,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  LIGHT_TILES_SHADER,
} from '../../gpu/core/shaderTexts.fixture.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('deferred resolve samples a shadowed list on a ranked image and walks every light otherwise', () => {
  // The branch, in the resolve alone: rank zero is the loop from before the batch, unchanged; a
  // moving tile whose list holds no shadowed light reads the tile pass's one-word flag (#1249).
  assert.match(
    DIRECT_LIGHTING_WGSL,
    /let rank=u32\(view\.viewport\.w\);\s*if\(rank==0u\|\|!tileShadowed\(tile,tilesX\)\)\{return tileLighting\(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE\);\}\s*return sampledTileLighting\(/,
  );
  // The flag is one read of the record beside its count, never a walk of its lights.
  assert.doesNotMatch(
    DIRECT_LIGHTING_WGSL.slice(DIRECT_LIGHTING_WGSL.indexOf('fn tileShadowed')).split('\n}')[0],
    /for\(/,
  );
  assert.doesNotMatch(DIRECT_LIGHTING_WGSL, /listShadowed/);
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.equal(occurrences(shader, DIRECT_LIGHT_SAMPLING_WGSL), 1);
    assert.equal(occurrences(shader, HASH_UNIT_WGSL), 1, 'one hash, defined once');
  }
  // The blend pass shades its lights in full: a forward surface has no history to average.
  assert.equal(occurrences(declaredLightingWgsl(11, 18, 26), 'sampledTileLighting'), 0);
});

test('a moving resolve reads the tile pass word once, never the list, to choose the sum (#1249, #1369)', () => {
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const STRIDE = layout.stride,
    SHADOW = layout.shadowBase;
  // Two tiles one pixel wide: the second tile's word decides the branch, alone — whatever its
  // count, which the depth mask may have taken to the sample budget or below (#1369).
  const run = (flag: number, kept = 8) => {
    const words = new Uint32Array(STRIDE * 2);
    words[0] = 8;
    words[STRIDE] = kept;
    words[STRIDE + SHADOW] = flag;
    const { contractLighting } = shaderFunctions<{
      contractLighting: (...args: unknown[]) => number;
    }>(DIRECT_LIGHTING_WGSL, ['contractLighting', 'tileShadowed', 'pixelTile'], {
      ...wgslConstants(DIRECT_LIGHTING_WGSL),
      view: { lightParams: { x: 2, y: 2, z: 1 }, viewport: { w: 7 } },
      vec3f: () => 0,
      tileLights: words,
      tileLighting: () => 1,
      sampledTileLighting: () => 2,
    });
    return contractLighting(0, 0, 0, 0, 0, 0, 0, { x: 20.5, y: 0.5 });
  };
  assert.equal(run(0), 1, 'not drawn: the exact full sum the still image shows');
  assert.equal(run(1), 2, 'drawn: the drawn resolve, unchanged');
  assert.equal(run(1, 2), 2, 'a list the mask shortened stays drawn');
  assert.equal(run(0, 12), 1, 'a list the pass did not choose is summed in full');
});

test('the tile pass word chooses on the list before the mask, as the list walk did (#1249, #1369)', () => {
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const word = (listed: number[], shadowed: number[], opaque = listed) =>
    compactTile(layout, { opaque, listed, blend: [], shadowed }, 300)[layout.shadowBase];
  const eight = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(word(eight, [2]), 1);
  assert.equal(word(eight, [9]), 0, 'a shadowed light outside the opaque list leaves it clear');
  assert.equal(word(eight, []), 0);
  assert.equal(word(eight, [2], [2]), 1, 'the mask leaves one light: still drawn');
  assert.equal(word(eight.slice(0, 4), [2]), 0, 'within the sample budget: summed in full');
  const past = [...Array(layout.tileLights + 1).keys()];
  assert.equal(word(past, [2], past.slice(0, 10)), 0, 'past the list: summed in full');
  assert.equal(compactTile(layout, { opaque: [], blend: [] }, 0)[layout.shadowBase], 0);
  // The pass counts every light its opaque slice keeps before the mask, and writes the choice.
  assert.match(
    LIGHT_TILES_SHADER,
    /tiles\[base\+TILE_SHADOW_BASE\]=select\(0u,1u,atomicLoad\(&shadowed\)!=0u&&sampledList\(atomicLoad\(&listed\)\)\);/,
  );
});

test('the sample budget is the published setting, and the full sum has one call site', () => {
  assert.match(
    DIRECT_LIGHTING_WGSL,
    new RegExp(`const LIGHT_SAMPLES:u32=${LIGHT_SETTINGS.samplesPerPixel}u;`),
  );
  // The full sum has one call site, the still image's: the drawn resolve never falls back on it.
  assert.equal(occurrences(DIRECT_LIGHTING_WGSL, 'return tileLighting('), 1);
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
