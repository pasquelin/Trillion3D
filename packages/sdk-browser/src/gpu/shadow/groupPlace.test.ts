// #1345: a moving group draws the restored sun pages of a pass in one block of the layer's, not in
// each page's own viewport. A snapped sun corner carried onto the block by the shipped `groupPlace`
// lands, after the rasterizer's f32 viewport, on the very window position its page's viewport gave
// it, at the pool's resolution and at the transmittance layer's half: the grouped draws write the
// texels the one-page draws wrote, to the bit (class 1). A lamp's page is carried onto its square of
// the layer as the GPU's own pages are (`freshPlace`), as the reference engine draws all the pages of a light in
// one pass: its perspective corner lands within one ulp of the window position its page's viewport
// gave it, one texel edge at most (class 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { groupBlockSide } from '../../webgpu/shadow/movingGroupPlan.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { GROUP_LAYER, SHADOW_GROUP_LAMP_WGSL } from './groupWgsl.ts';
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

test("a lamp corner carried onto its layer lands within one ulp of its page viewport's", () => {
  // The rasterizer divides a perspective corner by `w` before the viewport. Carried onto the page's
  // square of the layer (`freshPlace`: `x·s + o·w`, in f32), the quotient may round apart from the
  // page's own `x / w`: by one ulp of the layer's window positions at most (1/2048 texel on a layer
  // of 51 pages), so a texel edge moves only where a texel centre lies within that ulp, by one texel
  // — the class 2 bound of the grouped lamp pages. A sun corner has `w = 1` (above).
  const half = SHADOW_PAGE / 2,
    side = 51,
    layer = (side * SHADOW_PAGE) / 2,
    scale = f(half / layer),
    // One ulp of the layer's window positions, which reach its side (`2·layer` texels).
    ulp = 2 ** (Math.floor(Math.log2(2 * layer)) - 23);
  let apart = 0,
    worst = 0;
  for (let i = 0; i < 20000; i++) {
    const first = (i % side) * SHADOW_PAGE,
      centre = f((first + half) / layer - 1),
      w = f(0.1 + (i % 97) * 0.37),
      x = f(Math.sin(i * 12.9898) * w);
    const own = windowX(f(x / w), first, half),
      carried = windowX(f(f(f(x * scale) + f(centre * w)) / w), 0, layer),
      off = Math.abs(carried - own) / ulp;
    if (off) apart++;
    worst = Math.max(worst, off);
  }
  assert.ok(apart > 0, 'some corners land apart: the carry is not bit-exact, class 2');
  assert.ok(worst <= 1, `${apart} of 20 000 corners apart, ${worst} ulp at most`);
});

test("a lamp group's caster is clipped to its page's square by its distances, as its viewport did", () => {
  const rect = [-0.25, 0.5, 0.125, -0.125];
  let position: number[] = [];
  const { groupLampCaster } = shaderRun<{
    groupLampCaster: (v: number, i: number, cutout: boolean, blend: boolean) => { clip: number[] };
  }>(SHADOW_GROUP_LAMP_WGSL, ['groupLampCaster'], {
    groupViews: [{ rect }],
    groupCaster: () => ({ position, region: 0 }),
    GroupOut: (...fields: unknown[]) => ({ clip: fields[5] }),
  });
  const kept = (x: number, y: number, w: number) => {
    position = [x * w, y * w, 0.5, w];
    return groupLampCaster(0, 0, false, false).clip.every((d) => d >= 0);
  };
  // The page's square of the layer: x in [−0.375, −0.125], y in [0.375, 0.625], a flipped side.
  assert.equal(kept(-0.25, 0.5, 3), true, 'its centre');
  assert.equal(kept(-0.375, 0.625, 2), true, 'its corner, on the edge');
  for (const [x, y] of [
    [-0.4, 0.5],
    [-0.1, 0.5],
    [-0.25, 0.37],
    [-0.25, 0.63],
  ])
    assert.equal(kept(x, y, 3), false, `${x}, ${y}: past a side`);
  assert.equal(kept(-0.25, 0.5, -3), false, 'behind the lamp');
});
