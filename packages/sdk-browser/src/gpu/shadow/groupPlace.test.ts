// #1345: a moving group draws the restored sun pages of a pass in one block of the layer's, not in
// each page's own viewport. A snapped sun corner carried onto the block by the shipped `groupPlace`
// lands, after the rasterizer's f32 viewport, on the very window position its page's viewport gave
// it, at the pool's resolution and at the transmittance layer's half: the grouped draws write the
// texels the one-page draws wrote, to the bit. A lamp's page is carried onto its square of the
// layer as the GPU's own pages are (`freshPlace`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { groupBlockSide } from '../../webgpu/shadow/movingGroupPlan.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { GROUP_LAYER } from './groupWgsl.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { GROUP_CAPACITY_WORD } from './batchBudget.ts';

type Vec = { x: number; y: number; z: number; w: number };
const f = Math.fround;
const vec4f = (x: number, y: number, z: number, w: number): Vec => ({ x, y, z, w });
const ORTHO = [vec4f(1, 0, 0, 0), vec4f(0, 1, 0, 0), vec4f(0, 0, 1, 0), vec4f(0, 0, 0, 1)];
const run = shaderFunctions<{
  sunSnap: (view: object, p: Vec) => Vec;
  groupPlace: (p: Vec, first: object, half: number, origin: object, side: number) => Vec;
}>(SHADOW_DEPTH_SHADER, ['snapGrid', 'sunSnap', 'groupPlace'], { vec4f, abs: Math.abs });

/** The window position the rasterizer gives clip `x` (`y` down) in a viewport at `origin`,
 *  `half` texels a half side: its f32 sum, as the snap tests model it (`snap.test.ts`). */
const windowX = (x: number, origin: number, half: number) => f(f(origin + half) + f(x * half));
const windowY = (y: number, origin: number, half: number) => f(f(origin + half) - f(y * half));

test("a sun corner carried onto its group's block lands where its page's viewport put it", () => {
  const half = SHADOW_PAGE / 2;
  let checked = 0;
  for (const side of [16, 26, 51, 64, 71]) {
    const texels = side * SHADOW_PAGE,
      block = groupBlockSide(texels),
      view = { params: vec4f(0, 0, f(SHADOW_PAGE / texels), SHADOW_PAGE), viewProjection: ORTHO };
    for (let i = 0; i < 4000; i++) {
      // A page of the layer, and the block that holds it: at the layer's start or its end.
      const page = [i % side, Math.floor(i / side) % side].map((p) => p * SHADOW_PAGE);
      const origin = page.map((p) => (p + SHADOW_PAGE > block ? texels - block : 0));
      assert.ok(page.every((p, a) => p >= origin[a] && p + SHADOW_PAGE <= origin[a] + block));
      // Corners in the page and far past it, snapped as the depth pass snaps them.
      const reach = i % 3 ? 1.3 : 900;
      const p = run.sunSnap(
        view,
        vec4f(f(Math.sin(i * 12.9898) * reach), f(Math.cos(i * 78.233) * reach), 0.5, 1),
      );
      const first = { x: page[0], y: page[1] },
        at = { x: origin[0], y: origin[1] };
      const q = run.groupPlace(p, first, half, at, block / 2);
      for (const value of [q.x, q.y, q.x * (block / 2), q.y * (block / 2)])
        assert.equal(f(value), value, `f32 holds ${value}: the shader's own sum is exact`);
      assert.equal(windowX(q.x, at.x, block / 2), windowX(p.x, first.x, half), `x at ${page}`);
      assert.equal(windowY(q.y, at.y, block / 2), windowY(p.y, first.y, half), `y at ${page}`);
      assert.deepEqual([q.z, q.w], [p.z, p.w], 'depth untouched');
      // The transmittance layer's pass draws both at half: every term halves, exactly.
      const halfX = [windowX(q.x, at.x / 2, block / 4), windowX(p.x, first.x / 2, half / 2)];
      assert.equal(halfX[0], halfX[1], `x at half, at ${page}`);
      assert.equal(windowY(q.y, at.y / 2, block / 4), windowY(p.y, first.y / 2, half / 2));
      checked++;
    }
  }
  assert.equal(checked, 20000);
});

test("a lamp page's corner is carried onto its square of the layer, as the GPU's pages are", () => {
  // One group of lamp pages (`GROUP_LAYER`), its one pair, region 0's third row.
  const table = new Uint32Array(MAX_SHADOW_REGIONS + 4 + GROUP_CAPACITY_WORD);
  table.set([0, 1, GROUP_LAYER], MAX_SHADOW_REGIONS);
  table[GROUP_CAPACITY_WORD] = 4;
  const [x, y, sx, sy] = [-0.25, 0.5, 0.125, 0.125],
    view = { params: [0, 0, 1, SHADOW_PAGE] },
    groupViews = [{ view, rect: [x, y, sx, sy] }];
  const { groupCaster } = shaderRun<{
    groupCaster: (v: number, i: number, cutout: boolean, blend: boolean) => { position: number[] };
  }>(SHADOW_DEPTH_SHADER, ['groupCaster', 'freshPlace'], {
    ...{ groupTable: table, groupPairs: [2], groupViews, groupInstances: [0, 0, 9] },
    FreshView: (v: object, rect: number[]) => ({ view: v, rect }),
    // The clip square's corners, at a perspective w of 3.
    shadowVertexIn: (_: object, corner: number) => ({
      position: [corner & 1 ? 3 : -3, corner & 2 ? 3 : -3, 1.5, 3],
    }),
  });
  for (let corner = 0; corner < 4; corner++) {
    const [px, py, pz, pw] = groupCaster(corner, 0, false, false).position;
    assert.deepEqual(
      [px / pw, py / pw, pz, pw],
      [(corner & 1 ? 1 : -1) * sx + x, (corner & 2 ? 1 : -1) * sy + y, 1.5, 3],
      'the page quad corner (`page_quad_vs`), depth and w untouched',
    );
  }
});
