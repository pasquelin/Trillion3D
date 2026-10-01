// #1275: the pages the GPU draws itself, composed by the shipped WGSL (`freshWgsl.ts`) over a mock
// device: each is the projection and the cull volume the host composes for the same page
// (`writeLampPage`, `writeSunSquare`, on the one page model), placed where the host places it
// (`writePage`) and readable; and the casters the depth shader draws for it land on its square of
// the pool's layer, its fragments kept to its page alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOW_CULL_FLOATS,
  type SceneLight,
  type ShadowViewpoint,
} from '../../../../sdk-core/src/index.ts';
import { writeLampPage } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { writeSunSquare } from '../../../../sdk-core/src/scene/light-shadow/sunFaces.ts';
import {
  LAMP,
  SHADOW_TABLE_STRIDE,
  SUN,
  VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_VALID,
  SHADOW_PAGE,
  pageOrigin,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_FACE_STRIDE } from '../../gpu/shadow/batchBudget.ts';
import { createShadowRecordPack } from '../../gpu/shadow/recordPack.ts';
import {
  FRESH_ARG,
  FRESH_CLEAR,
  FRESH_FACE_WORDS,
  FRESH_LAYER_SHIFT,
  FRESH_LAYER_STARTS,
  freshArgWords,
  freshDrawWord,
} from './freshLayout.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_DEPTH_SHADER } from '../../gpu/shadow/shader.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { freshPage } from '../../gpu/shadow/freshPage.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';
import { DRAWN_GPU } from './poolDrawn.ts';
import { SHADOW_FACE_READ_WORDS } from '../../gpu/shadow/faceReadWords.ts';

const SIDE = 16;
const close = (gpu: number, host: number, what: string) =>
  assert.ok(
    Math.abs(gpu - host) <= 1e-5 * Math.max(1, Math.abs(host)),
    `${what}: ${gpu} ≠ ${host}`,
  );

test('the GPU composes each page it draws as the host composes it, and makes it readable', async () => {
  const lamp: SceneLight = { ...LAMP, position: [1, 3, -10], range: 20 };
  const run = gpuFrames(SIDE, [SUN, lamp]),
    view: ShadowViewpoint = { ...VIEW, position: [0, 4, 2], forward: [0, -0.3, -0.954] };
  await run.frame(1, view, floorTiles(tileGrid(-4, 4, -14, -6), 3).lits, () => {});
  const { store, plan, table, owner, field, regions, drawnAt } = run;
  const [faces, volumes] = [run.views, run.volumes].map((bytes) => new Float32Array(bytes.buffer));
  const pack = createShadowRecordPack(SHADOW_FACE_STRIDE, SIDE),
    matrix = new Float32Array(16),
    volume = new Float32Array(SHADOW_CULL_FLOATS),
    kinds = new Set<string>();
  assert.ok(regions.length > 0, 'the frame draws pages');
  regions.forEach((page, k) => {
    const entry = owner[page],
      slice = Math.floor(entry / SHADOW_TABLE_STRIDE);
    const light = store.light(store.ids.find((_, slot) => store.sliceOf(slot) === slice)!)!;
    const [at, x, y] = (['view', 'x', 'y'] as const).map((name) => field(name)[page]);
    const sun = light.kind === 'directional';
    kinds.add(light.kind);
    if (sun) writeSunSquare(matrix, 0, volume, 0, plan.sun, slice, at, x, y);
    else writeLampPage(matrix, 0, volume, 0, light, at >> 4, at & 15, x, y);
    const face = faces.subarray(k * FRESH_FACE_WORDS),
      cull = volumes.subarray(k * SHADOW_CULL_FLOATS);
    for (let i = 0; i < 16; i++) close(face[i], matrix[i], `page ${page}, matrix ${i}`);
    // A cone is its apex, far plane, axis and half-angle; a box is all sixteen.
    for (let i = 0; i < (sun ? 16 : 8); i++) close(cull[i], volume[i], `page ${page}, volume ${i}`);
    // Where the host puts the same page (`writePage`): its place, emitter and clip square.
    pack.writePage(0, matrix, 0, page, light.position, light.emitterRadius ?? 0);
    for (let i = 16; i < SHADOW_FACE_READ_WORDS + 4; i++)
      close(face[i], pack.facePacked[i], `page ${page}, face word ${i}`);
    assert.equal(table[entry] & (PAGE_INDEX_MASK | PAGE_VALID), page | PAGE_VALID);
    assert.equal(field('drawnBy')[page], DRAWN_GPU);
    assert.equal(drawnAt[page], 1);
  });
  assert.deepEqual([...kinds].sort(), ['directional', 'point'], 'both lights draw pages');
});

test("a GPU-drawn page's casters land on its square of the layer, its fragments on it alone", () => {
  for (const page of [0, 5, 17, SIDE * SIDE - 1]) {
    const fresh = freshPage(SIDE, page);
    const { x, y } = pageOrigin(page, SIDE);
    // The page's clip square, at a perspective w: its corners land on its first and last texels.
    for (const [cx, cy] of [
      [-1, -1],
      [1, 1],
    ]) {
      const [wx, wy] = fresh.window([cx * 2, cy * 2, 0.5, 2]);
      close(wx, x + ((cx + 1) / 2) * SHADOW_PAGE, `page ${page} x`);
      close(wy, y + ((1 - cy) / 2) * SHADOW_PAGE, `page ${page} y`);
    }
    const inside = (dx: number, dy: number) => fresh.holds([x + dx, y + dy]);
    assert.ok(inside(0.5, 0.5) && inside(SHADOW_PAGE - 0.5, SHADOW_PAGE - 0.5), `page ${page}`);
    assert.ok(!inside(-0.5, 0.5) && !inside(0.5, SHADOW_PAGE + 0.5), `page ${page}: beside it`);
  }
});

test("each layer's draw places the pairs of its own regions, by their own view", () => {
  // Region 0 lies in layer 0, region 1 in layer 1; pair 0 is region 0's row 7, pair 1 region 1's,
  // both still casters' (`freshPairAt`).
  const args = new Uint32Array(freshArgWords(4));
  args.set([0, 1], FRESH_LAYER_STARTS);
  args[FRESH_ARG.still] = 2;
  args[freshDrawWord(0, FRESH_CLEAR) + 1] = args[freshDrawWord(1, FRESH_CLEAR) + 1] = 1;
  const views = [0, 1].map((k) => ({ view: { params: [0, 0, 1, 1] }, rect: [k, 0, 1, 1] }));
  const { freshCaster } = shaderRun<{
    freshCaster: (vertex: number, instance: number, blended: boolean) => Record<string, unknown>;
  }>(SHADOW_DEPTH_SHADER, ['freshCaster', 'freshPairAt', 'freshPlace', 'freshDraw'], {
    ...wgslConstants(SHADOW_DEPTH_SHADER),
    freshArgs: args,
    freshPairs: [0, 7, 1, 7],
    freshFaces: views,
    ShadowOut: (position: number[]) => ({ position }),
    shadowVertexIn: (view: { rect: number[] }, corner: number, row: number) => ({
      position: [0.5, 0.5, 0.5, 1],
      corner,
      row,
    }),
  });
  const layer1 = (corner: number) => (1 << FRESH_LAYER_SHIFT) | corner;
  assert.equal((freshCaster(layer1(2), 0, false).position as number[])[2], 2, 'none in layer 1');
  const drawn = freshCaster(layer1(2), 1, false);
  assert.deepEqual([drawn.region, drawn.corner, drawn.row], [1, 2, 7]);
  assert.deepEqual(drawn.position, [1.5, 0.5, 0.5, 1], "placed on region 1's square");
});
