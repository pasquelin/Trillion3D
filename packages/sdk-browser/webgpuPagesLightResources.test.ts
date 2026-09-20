// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLAG_MASK, PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { ROW_FLAGS_WORD, ROW_MAP_LAYER_WORD } from './webgpuPageRow.ts';
import { shadowsFollowTextures } from './webgpuPagesLightResources.ts';
import type { PageRec } from './pageSelectionTypes.ts';

const WORDS = PAGE_INFO_STRIDE / 4;

function record(x: number) {
  return {
    matrix: new THREE.Matrix4().makeTranslation(x, 0, 0),
    min: [-1, -1, -1],
    max: [1, 1, 1],
  } as PageRec;
}

/** Three rows: a masked cutout on texture 3, an opaque surface on texture 3, a cutout on texture 5. */
function table() {
  const ints = new Uint32Array(3 * WORDS);
  ints[0 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK;
  ints[0 * WORDS + ROW_MAP_LAYER_WORD] = 3;
  ints[1 * WORDS + ROW_FLAGS_WORD] = 0;
  ints[1 * WORDS + ROW_MAP_LAYER_WORD] = 3;
  ints[2 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK;
  ints[2 * WORDS + ROW_MAP_LAYER_WORD] = 5;
  return { rowCount: 3, pageTableInts: ints, packedRecs: [record(0), record(100), record(10)] };
}

function lightsSpy() {
  const boxes: number[][] = [];
  const lights = {
    plan: { representationChanged: (min: number[], max: number[]) => boxes.push([...min, ...max]) },
  } as unknown as Parameters<typeof shadowsFollowTextures>[0];
  return { lights, boxes };
}

test('a tile of a texture read by a cutout stales the box of that cutout, not the opaque surface beside it', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), 3);
  assert.equal(boxes.length, 1);
  // Row 0 alone: its sphere has radius √3 around the origin, in single precision as the GPU
  // reads it. Row 1, opaque at x = 100, is left out.
  const r = Math.fround(Math.sqrt(3));
  assert.deepEqual(boxes[0], [-r, -r, -r, r, r, r]);
});

test('a tile of a texture no cutout reads stales nothing', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), 7);
  assert.equal(boxes.length, 0);
});

test('an unnamed pool change — resize, eviction — still restarts everything', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), -1);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0][0] < -1e29 && boxes[0][3] > 1e29);
});
