// #1345: a moving group draws the restored sun pages of a pass in one block of the layer's, not in
// each page's own viewport. A snapped sun corner carried onto the block by the shipped `groupPlace`
// lands, after the rasterizer's f32 viewport, on the very window position its page's viewport gave
// it, at the pool's resolution and at the transmittance layer's half: the grouped draws write the
// texels the one-page draws wrote, to the bit. A lamp's perspective corner cannot be carried so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { groupBlockSide } from '../../webgpu/shadow/movingGroupPlan.ts';

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

test("a lamp corner carried onto its layer misses its page viewport's f32 window position", () => {
  // Why a lamp page keeps its own draw (`movingGroupPlan.ts`): its corner is perspective, so the
  // rasterizer divides it by `w` before the viewport. Carried onto the page's square of the layer
  // (`freshPlace`: `x·s + o·w`, f32), the quotient rounds apart from the page's own `x / w`: a
  // texel edge moves, the bit-exact draw of class 1 is lost. A sun corner has `w = 1` (test above).
  const half = SHADOW_PAGE / 2,
    side = 51,
    layer = (side * SHADOW_PAGE) / 2,
    scale = f(half / layer);
  let missed = 0;
  for (let i = 0; i < 20000; i++) {
    const first = (i % side) * SHADOW_PAGE,
      centre = f((first + half) / layer - 1),
      w = f(0.1 + (i % 97) * 0.37),
      x = f(Math.sin(i * 12.9898) * w);
    const own = windowX(f(x / w), first, half),
      carried = f(f(x * scale) + f(centre * w));
    if (windowX(f(carried / w), 0, layer) !== own) missed++;
  }
  assert.ok(missed > 0, `${missed} of 20 000 lamp corners land on another window position`);
});
