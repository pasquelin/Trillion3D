import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { vec4f, type Mat } from './depthSplit.fixture.ts';
import { PAGE_STEPS, SHADOW_CORNER_WGSL } from './shader.ts';

type Vec = Record<string, number>;
type Corner = { shadowSunCorner: (m: Mat, p: Vec) => Vec };
const f32 = Math.fround;
const LAYER = 51;

/** The positions in its page the rasterizer sees for a corner at `c`, one per slot of a pool of
 *  `LAYER`-page rows: the viewport transform in f32, the slot's integer origin taken off again. */
const inPage = (c: number) =>
  new Set(
    [0, 17, LAYER - 1, LAYER * 30 + 49, LAYER * LAYER - 1].map((slot) => {
      const x = pageOrigin(slot, LAYER).x;
      return f32(x + f32(f32(f32(c * 0.5) + 0.5) * SHADOW_PAGE)) - x;
    }),
  );

/** A projection by its columns, its last row `lastRow`. */
const projection = (lastRow: number[]): Mat =>
  lastRow.map((w, column) => vec4f(...[0, 1, 2].map((row) => (row === column ? 1 : 0)), w));

test('a sun page rasterizes its caster at the same place in every pool slot (#26)', () => {
  const { shadowSunCorner } = shaderFunctions<Corner>(
    SHADOW_CORNER_WGSL,
    ['shadowPageCorner', 'shadowSunCorner'],
    {
      vec4f,
      floor: Math.floor,
    },
  );
  const sun = projection([0, 0, 0, 1]);
  const corners = [-3.1234567, -0.77777, 0.1, 0.123456789, 0.99999, 12.3456].map(f32);
  // As projected, the corner's low bits are rounded away by the slot's origin, differently in
  // each slot.
  assert.ok(
    corners.some((c) => inPage(c).size > 1),
    'the slot moves the corner',
  );
  for (const c of corners) {
    const snapped = shadowSunCorner(sun, vec4f(c, c, 0.5, 1));
    for (const axis of ['x', 'y']) {
      assert.equal(inPage(snapped[axis]).size, 1, `corner ${c}`);
      assert.ok(Math.abs(snapped[axis] - c) <= 1 / PAGE_STEPS, 'within half a 1/256 texel');
    }
    assert.equal(snapped.z, f32(0.5));
  }
});

test("a lamp page's corner is left to the hardware divide, even at w = 1 (#26)", () => {
  const { shadowSunCorner } = shaderFunctions<Corner>(
    SHADOW_CORNER_WGSL,
    ['shadowPageCorner', 'shadowSunCorner'],
    {
      vec4f,
      floor: Math.floor,
    },
  );
  const lamp = projection([0, 0, -1, 0]);
  const corner = vec4f(0.123456789, -0.77777, 0.5, 1);
  assert.deepEqual(shadowSunCorner(lamp, corner), corner);
});
