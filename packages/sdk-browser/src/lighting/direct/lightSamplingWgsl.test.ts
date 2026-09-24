import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DIRECT_LIGHT_SAMPLING_WGSL, SAMPLED_RANKS } from './lightSamplingWgsl.ts';
import { DIRECT_LIGHTING_WGSL, declaredLightingWgsl } from './lightingWgsl.ts';
import { BOUNCE_LIGHTING_SHADER, DIRECT_LIGHTING_SHADER } from '../deferred/shaders.ts';
import { HASH_UNIT_WGSL } from '../../math/hashUnitWgsl.ts';

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
  assert.equal(occurrences(declaredLightingWgsl(11, 18), 'sampledTileLighting'), 0);
});

test('the sample budget is the published setting, and a list within it is summed in full', () => {
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    new RegExp(`const LIGHT_SAMPLES:u32=${LIGHT_SETTINGS.samplesPerPixel}u;`),
  );
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    /if\(kept<=LIGHT_SAMPLES\)\{return tileLighting\(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE\);\}/,
  );
  // A light worth a sample's share is shaded exactly and leaves the pool; the drawn ones are
  // divided by their probability, copies counted.
  assert.match(DIRECT_LIGHT_SAMPLING_WGSL, /if\(weights\[index\]\*f32\(LIGHT_SAMPLES\)>=total\)/);
  assert.match(DIRECT_LIGHT_SAMPLING_WGSL, /factors\[used\]=pool\/\(f32\(samples\)\*weight\);/);
  // The offset depends on the pixel and the bounded rank only: a replayed image is the same image.
  assert.match(
    DIRECT_LIGHT_SAMPLING_WGSL,
    /fract\(hashUnit\(u32\(pixel\.y\)\*65536u\+u32\(pixel\.x\)\)\+f32\(rank\)\*GOLDEN_RATIO\)/,
  );
  assert.ok(SAMPLED_RANKS * 0.61803399 < 2 ** 10, 'the rank keeps the fraction its precision');
});
