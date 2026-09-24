// A page becomes one region, or two when its static layer is redrawn: each names its start and
// the casters its cull keeps, the second one's volume copied from the first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { SHADOW_CULL_CASTERS } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import {
  DRAW_ALL,
  DRAW_DYNAMIC,
  DRAW_FULL,
} from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { CASTERS_ALL, CASTERS_MOVING, CASTERS_STATIC } from '../../gpu/shadow/cullShader.ts';
import { createShadowRegionList, REGION_CLEAR, REGION_RESTORE, REGION_STATIC } from './regions.ts';

test('regions follow the draw mode: whole, layer then moving casters, or moving casters alone', () => {
  const list = createShadowRegionList(32);
  const volumes = new Float32Array(8 * SHADOW_CULL_FLOATS),
    words = new Uint32Array(volumes.buffer);
  volumes[0] = 42;
  assert.equal(list.push(33, DRAW_ALL, volumes, words), 1);
  volumes[SHADOW_CULL_FLOATS] = 7;
  assert.equal(list.push(34, DRAW_FULL, volumes, words), 2);
  assert.equal(list.push(35, DRAW_DYNAMIC, volumes, words), 1);
  const starts = [0, 1, 2, 3].map(list.startOf),
    casters = [0, 1, 2, 3].map((r) => words[r * SHADOW_CULL_FLOATS + SHADOW_CULL_CASTERS]);
  assert.deepEqual(starts, [REGION_CLEAR, REGION_STATIC, REGION_RESTORE, REGION_RESTORE]);
  assert.deepEqual(casters, [CASTERS_ALL, CASTERS_STATIC, CASTERS_MOVING, CASTERS_MOVING]);
  assert.equal(volumes[2 * SHADOW_CULL_FLOATS], 7, "the page's second region shares its volume");
  assert.deepEqual([list.pageOf(2), list.x(2), list.y(2)], [34, 2 * 128, 128]);
  assert.equal(list.layered, 1);
});
