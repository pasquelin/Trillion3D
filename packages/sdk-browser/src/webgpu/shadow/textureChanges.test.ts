// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The textures a pump changed are declared together: one scan of the page table, one box.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { FLAG_BLEND_CASTER, FLAG_MASK, PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { ROW_FLAGS_WORD, ROW_MAP_LAYER_WORD } from '../row/pageRow.ts';
import { shadowsFollowTextures } from '../pages/prepare/lightResources.ts';
import type { PageRec } from '../../page/selection/types.ts';

const WORDS = PAGE_INFO_STRIDE / 4;

function record(x: number) {
  return {
    matrix: new G.Matrix4().makeTranslation(x, 0, 0),
    min: [-1, -1, -1],
    max: [1, 1, 1],
  } as unknown as PageRec;
}

/** Three visibility rows — a masked cutout on texture 3, an opaque surface on texture 3, a cutout
 *  on texture 5 —, then a blended caster's row on texture 7 (#35). */
function table() {
  const ints = new Uint32Array(4 * WORDS);
  ints[0 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK;
  ints[0 * WORDS + ROW_MAP_LAYER_WORD] = 3;
  ints[1 * WORDS + ROW_FLAGS_WORD] = 0;
  ints[1 * WORDS + ROW_MAP_LAYER_WORD] = 3;
  ints[2 * WORDS + ROW_FLAGS_WORD] = FLAG_MASK;
  ints[2 * WORDS + ROW_MAP_LAYER_WORD] = 5;
  ints[3 * WORDS + ROW_FLAGS_WORD] = FLAG_BLEND_CASTER;
  ints[3 * WORDS + ROW_MAP_LAYER_WORD] = 7;
  const packedRecs = [record(0), record(100), record(10), record(-20)];
  return { rowCount: 3, blendFirst: 3, casterSlots: 4, pageTableInts: ints, packedRecs };
}

function lightsSpy() {
  const boxes: number[][] = [];
  const lights = {
    store: { count: 1 },
    plan: { representationChanged: (min: number[], max: number[]) => boxes.push([...min, ...max]) },
  } as unknown as Parameters<typeof shadowsFollowTextures>[0];
  return { lights, boxes };
}

const r = Math.fround(Math.sqrt(3));

test('a tile of a texture read by a cutout stales the box of that cutout, not the opaque surface beside it', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), new Set([3]));
  assert.equal(boxes.length, 1);
  // Row 0 alone: its sphere has radius √3 around the origin, in single precision as the GPU
  // reads it. Row 1, opaque at x = 100, is left out.
  assert.deepEqual(boxes[0], [-r, -r, -r, r, r, r]);
});

test('tiles of two textures served by one pump declare one box, the union of their cutouts', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), new Set([3, 5]));
  assert.equal(boxes.length, 1, 'one scan, one change');
  assert.deepEqual(boxes[0], [-r, -r, -r, 10 + r, r, r]);
});

test('a tile of a texture no cutout reads stales nothing', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), new Set([9]));
  assert.equal(boxes.length, 0);
});

test('a tile of a texture a blended caster reads stales that caster, whose coverage it carries', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), new Set([7]));
  assert.deepEqual(boxes, [[-20 - r, -r, -r, -20 + r, r, r]]);
});

test('a resize, which names no texture, still restarts everything', () => {
  const { lights, boxes } = lightsSpy();
  shadowsFollowTextures(lights, table(), -1);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0][0] < -1e29 && boxes[0][3] > 1e29);
});

test('with no light declared, a tile stales nothing and leaves no change waiting', () => {
  const { lights, boxes } = lightsSpy();
  (lights.store as { count: number }).count = 0;
  shadowsFollowTextures(lights, table(), -1);
  assert.equal(boxes.length, 0);
});
