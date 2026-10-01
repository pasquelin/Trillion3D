// #1016: a sun page clips its casters at its x/y edge the way a virtual shadow map's page does —
// whole-caster bounds against the page's whole footprint, then the rasterizer's clip — so a caster
// straddling the edge keeps every texel it covers inside the page, and one wholly outside writes
// none. Under the sun's orthography no texel of the page can be shadowed by what lies beside its
// footprint. The cull is the shader's box test (`cullBox.fixture.ts`), the texels are placed and
// kept by the shipped WGSL (`freshPlace`, `pageHolds`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformHomogeneousPoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import {
  sunPageVolume,
  sunScene,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { sunPageMetres } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { keeps } from './cullBox.fixture.ts';
import { freshPage } from './freshPage.fixture.ts';

const SIDE = 16,
  PHYSICAL = 37,
  HALF = 6;

/** Sun page (3, 2) of a level, drawn into physical page `PHYSICAL`: what the cull keeps of a square
 *  caster of `HALF` texels a half side centred on texel `(cx, cy)` of the virtual page, and the
 *  page texels its covered texels write. */
function draw(cx: number, cy: number) {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    texel = sunPageMetres(level) / SHADOW_PAGE;
  const matrix = new Float32Array(16),
    volume = sunPageVolume(plan, slice, level, 3, 2, matrix);
  const frame = plan.sun.frame.subarray(slice * 9, slice * 9 + 6);
  // The world point of texel `(x, y)` of the virtual page, on the plane of its box's centre.
  const at = (x: number, y: number) => {
    const u = (x - SHADOW_PAGE / 2) * texel,
      v = (SHADOW_PAGE / 2 - y) * texel;
    return [0, 1, 2].map((a) => volume[a] + frame[a] * u + frame[3 + a] * v);
  };
  const fresh = freshPage(SIDE, PHYSICAL, matrix),
    origin = pageOrigin(PHYSICAL, SIDE),
    clip = [0, 0, 0, 0];
  const kept = keeps(volume, at(cx, cy), Math.SQRT2 * HALF * texel);
  const written: number[][] = [];
  for (let y = cy - HALF + 0.5; y < cy + HALF; y++)
    for (let x = cx - HALF + 0.5; x < cx + HALF; x++) {
      const [wx, wy, wz] = at(x, y);
      const window = fresh.window(transformHomogeneousPoint(clip, matrix, wx, wy, wz));
      if (fresh.holds(window))
        written.push([
          Math.round(window[0] - origin.x - 0.5),
          Math.round(window[1] - origin.y - 0.5),
        ]);
    }
  return { kept, written: kept ? written : [] };
}

test("a caster straddling a sun page's x/y edge writes every texel it covers inside the page", () => {
  const edge = SHADOW_PAGE - 2;
  for (const [cx, cy] of [
    [edge, SHADOW_PAGE / 2],
    [SHADOW_PAGE / 2, edge],
    [2, 2],
    [SHADOW_PAGE + 2, -2], // its centre past the corner, its bounds over the page
  ]) {
    const { kept, written } = draw(cx, cy);
    assert.ok(kept, `the cull keeps the caster at (${cx}, ${cy})`);
    const inside: string[] = [];
    for (let y = Math.max(0, cy - HALF); y < Math.min(SHADOW_PAGE, cy + HALF); y++)
      for (let x = Math.max(0, cx - HALF); x < Math.min(SHADOW_PAGE, cx + HALF); x++)
        inside.push(`${x},${y}`);
    assert.ok(inside.length < 4 * HALF * HALF, 'the caster reaches past the page');
    assert.deepEqual(
      written.map(String).sort(),
      inside.sort(),
      'its in-page texels, and those alone',
    );
  }
});

test("a caster wholly outside a sun page's x/y footprint writes none of its texels", () => {
  // Beside the edge, its bounding sphere still meets the page's box: kept, every texel discarded.
  const near = draw(SHADOW_PAGE + HALF + 1, SHADOW_PAGE / 2);
  assert.ok(near.kept, 'its sphere meets the box');
  assert.equal(near.written.length, 0, 'no texel past the edge is written');
  for (const [cx, cy] of [
    [SHADOW_PAGE + 2 * HALF, SHADOW_PAGE / 2],
    [SHADOW_PAGE / 2, -2 * HALF],
  ]) {
    const { kept, written } = draw(cx, cy);
    assert.ok(!kept, `the cull drops the caster at (${cx}, ${cy})`);
    assert.equal(written.length, 0);
  }
});
