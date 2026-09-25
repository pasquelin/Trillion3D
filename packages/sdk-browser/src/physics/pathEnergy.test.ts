import test from 'node:test';
import assert from 'node:assert/strict';
import { energiesOverALap, G } from './joints.fixture.ts';

test('a body on a frictionless vertical loop keeps its energy over a lap, to within a step of gravity', async () => {
  const R = 5,
    N = 64;
  const loop = Array.from({ length: N }, (_, i): [number, number, number] => {
    const a = (i / N) * 2 * Math.PI;
    return [R * Math.sin(a), R + 1 - R * Math.cos(a), 0];
  });
  // Fast enough to go over the top: v² > 4·g·R at the bottom.
  const { drift, fastest, lapped } = await energiesOverALap(loop, 16);
  assert.ok(lapped, 'round the loop within a minute');
  // The step's own error: gravity's work over one step, measured at the fastest speed (g·v·dt).
  const tolerance = (G * fastest) / 60;
  assert.ok(drift < tolerance, `energy off by ${drift} J/kg over a lap, ${tolerance} allowed`);
});
