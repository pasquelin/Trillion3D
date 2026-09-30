// #1249: the resolve's one light loop rejects a light on its sphere alone, before its record is
// read in full, only where `declaredLight` would have given an exact zero. The shipped
// `sliceLighting` runs here as JavaScript on a line (a light's centre and the point are distances
// along it), the light's own term a stand-in of `directIncidence`: zero at or past its range.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_LIGHTING_WGSL } from './lightingWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';

const K = wgslConstants(DIRECT_LIGHTING_WGSL);
type Lamp = { positionRange: { xyz: number; w: number }; params: { x: number }; weight: number };

/** The loop over `lamps` at point `P`: its sum and the lamps it shaded in full. */
function walk(lamps: Lamp[], P: number) {
  const shaded: Lamp[] = [];
  const { sliceLighting } = shaderFunctions<{ sliceLighting: (...args: unknown[]) => number }>(
    DIRECT_LIGHTING_WGSL,
    ['sliceLighting'],
    {
      ...K,
      abs: Math.abs,
      dot: (a: number, b: number) => a * b,
      vec3f: () => 0,
      tileLights: [],
      directLights: { items: lamps },
      declaredLight: (lamp: Lamp) => {
        shaded.push(lamp);
        const sun = Math.abs(lamp.params.x - K.KIND_SUN) < 0.5;
        return sun || Math.abs(lamp.positionRange.xyz - P) < lamp.positionRange.w ? lamp.weight : 0;
      },
    },
  );
  const sum = sliceLighting(0, 0, 0, 0, 0, P, 0, { x: K.TILE_NO_SLICE, y: lamps.length });
  return { sum, shaded };
}

test('a light past its range is skipped, one in range or the sun always shaded (#1249)', () => {
  const r = random(1249);
  for (let run = 0; run < 50; run++) {
    const lamps: Lamp[] = [...Array(64).keys()].map((rank) => ({
      positionRange: { xyz: r() * 40, w: r() * 8 },
      params: { x: rank === 7 ? K.KIND_SUN : 0 },
      weight: 0.5 + r(),
    }));
    const P = r() * 40;
    const { sum, shaded } = walk(lamps, P);
    const reach = lamps.filter(
      (l, rank) => rank === 7 || Math.abs(l.positionRange.xyz - P) < l.positionRange.w,
    );
    assert.equal(
      sum,
      reach.reduce((total, l) => total + l.weight, 0),
      'the sum of those in range',
    );
    for (const lamp of reach) assert.ok(shaded.includes(lamp), 'every lamp in range is shaded');
    for (const lamp of shaded) {
      const past = (lamp.positionRange.xyz - P) ** 2 > lamp.positionRange.w ** 2 * K.RANGE_REJECT;
      assert.ok(!past || lamp.params.x === K.KIND_SUN, 'none past its range reaches the shading');
    }
    assert.ok(shaded.length < lamps.length, 'the reject skipped some');
  }
});

test('the reject margin keeps a lamp at its very range: the shading gives its zero', () => {
  const lamp = (distance: number): Lamp => ({
    positionRange: { xyz: 10 + distance, w: 2 },
    params: { x: 0 },
    weight: 1,
  });
  const edge = walk([lamp(2), lamp(2 * (1 + 1e-5))], 10);
  assert.deepEqual([edge.shaded.length, edge.sum], [2, 0], 'within the margin: shaded, and zero');
  assert.equal(walk([lamp(2.02)], 10).shaded.length, 0, 'past it: skipped');
});
