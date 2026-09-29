import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { SHADOW_CORNER_WGSL } from './shader.ts';

type Corner = { shadowPageCorner: (c: number) => number };
const f32 = Math.fround;

/** The positions in its page the rasterizer sees for a corner at `c`, one per slot of a pool of
 *  51-page layers: the viewport transform in f32, the slot's integer origin taken off again. */
const inPage = (c: number) =>
  new Set(
    [0, 17, 50, 51 * 30 + 49, 51 * 51 - 1].map((slot) => {
      const x = pageOrigin(slot, 51).x;
      return f32(x + f32(f32(f32(c * 0.5) + 0.5) * SHADOW_PAGE)) - x;
    }),
  );

test('a sun page rasterizes its caster at the same place in every pool slot (#26)', () => {
  const { shadowPageCorner } = shaderFunctions<Corner>(SHADOW_CORNER_WGSL, ['shadowPageCorner']);
  const corners = [-3.1234567, -0.77777, 0.1, 0.123456789, 0.99999, 12.3456].map(f32);
  // As projected, the corner's low bits are rounded away by the slot's origin, differently in
  // each slot.
  assert.ok(
    corners.some((c) => inPage(c).size > 1),
    'the slot moves the corner',
  );
  for (const c of corners) {
    const snapped = f32(shadowPageCorner(c));
    assert.equal(inPage(snapped).size, 1, `corner ${c}`);
    assert.ok(Math.abs(snapped - c) <= 1 / (SHADOW_PAGE * 256), 'within half a 1/256 texel');
  }
});
