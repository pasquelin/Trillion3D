// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile
// of a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The textures a pump changed are declared together: one scan of the page table, one box.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLAG_MASK, PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { ROW_FLAGS_WORD, ROW_MAP_LAYER_WORD } from '../row/pageRow.ts';
import { shadowsFollowTextures } from '../pages/prepare/lightResources.ts';
import { followSurfaceSampling } from '../pages/prepare/textureSampling.ts';
import { createWebgpuTilePageTable } from '../tile/pageTable.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import type { PageRec } from '../../page/selection/types.ts';
import type { WebgpuPagesCore } from '../pages/runtime.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { VisMaterial } from '../../visibility/types.ts';

const WORDS = PAGE_INFO_STRIDE / 4;

function record(x: number) {
  return {
    matrix: new THREE.Matrix4().makeTranslation(x, 0, 0),
    min: [-1, -1, -1],
    max: [1, 1, 1],
  } as unknown as PageRec;
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
  shadowsFollowTextures(lights, table(), new Set([7]));
  assert.equal(boxes.length, 0);
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

// #360, #361: a cutout's silhouette is its colour map read through its UV transform and filters;
// when those move after the session opened, the shadows cached with the old silhouette go stale
// exactly as when a tile of that map lands. A colour change alone sends nothing and stales nothing.
test("a cutout map's sampling written after opening stales its shadows; a colour alone does not", () => {
  installGpuGlobals();
  const writes: number[] = [];
  const device = {
    createBuffer: () => ({ destroy: () => {} }),
    queue: { writeBuffer: (_b: unknown, offset: number) => writes.push(offset / 4) },
  } as unknown as GPUDevice;
  const atlas = () => ({
    pages: createWebgpuTilePageTable(
      device,
      Array.from({ length: 6 }, () => tileLayout(8, 8)),
      { kind: 'color', feedbackOffset: 0 },
    ),
  });
  const color = atlas(),
    data = atlas();
  const map = {
    magFilter: 'linear',
    minFilter: 'linear-mip-linear',
    anisotropy: 1,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  } as unknown as Texture & { transform: number[] };
  // What the preparation wrote: the sampling of every map, at its slot.
  color.pages.setSampling(3, map);
  color.pages.flush(device);
  const { lights, boxes } = lightsSpy();
  const rt = {
    vis: {
      textures: {
        color,
        data,
        flushTables: () => (color.pages.flush(device), data.pages.flush(device)),
      },
      mapLayer: new Map([[map, 3]]),
      dataLayer: new Map(),
    },
    lights,
    layout: { rows: table() },
  } as unknown as WebgpuPagesCore;
  const surface = { map } as unknown as VisMaterial;
  writes.length = 0;
  followSurfaceSampling(rt, surface);
  assert.deepEqual([writes, boxes], [[], []], 'a new colour: nothing sent, nothing stale');
  map.transform[0] = 4;
  followSurfaceSampling(rt, surface);
  assert.equal(writes.length, 1, 'the moved words sent');
  assert.deepEqual(boxes, [[-r, -r, -r, r, r, r]], 'the cutout on that map, not the others');
});
