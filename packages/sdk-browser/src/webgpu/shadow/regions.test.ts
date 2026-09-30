// A page's region opens the pool layer that holds the page, where the shading reads it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_ALL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { createShadowRegionList } from './regions.ts';
import { directShadowWgsl } from '../../lighting/direct/shadowWgsl.ts';

test('page 4 096 of a pool 64 pages a side opens its layer 1, where the shading reads it', () => {
  const list = createShadowRegionList(64);
  const volumes = new Float32Array(4 * SHADOW_CULL_FLOATS),
    words = new Uint32Array(volumes.buffer);
  for (const page of [4095, 4096, 4096 + 65]) list.push(page, DRAW_ALL, volumes, words);
  const place = (r: number) => [list.layer(r), list.x(r) / 128, list.y(r) / 128];
  assert.deepEqual([0, 1, 2].flatMap(place), [0, 63, 63, 1, 0, 0, 1, 1, 1]);
  // The shading's `shadowOffset`, the same place: the page within its layer, then the layer.
  const offset = /let layer=floor\(\(phys\+0\.5\)\/area\);[^}]*,layer\);/;
  assert.match(directShadowWgsl(8, null, 18), offset);
});
