// The resolve's UV gradients (`UV_GRADIENTS_WGSL`) are the derivatives a fragment reads, exact at
// the pixel: one formula in WGSL, its CPU mirror `uvDerivatives` in TypeScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UV_GRADIENTS_WGSL } from './pageWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { uvDerivatives } from '../math.ts';

test('the resolve reads the one gradient formula and keeps no copy', () => {
  assert.equal(SHADE_SHADER.split(UV_GRADIENTS_WGSL).length - 1, 1);
  assert.match(SHADE_SHADER, /=uvGradients\(/);
  assert.doesNotMatch(SHADE_SHADER.replace(UV_GRADIENTS_WGSL, ''), /dUdx|dsdx/);
});

test('its CPU mirror matches central differences of perspective-correct interpolation', () => {
  const at = (x: number, y: number, invW: number) =>
    ({ x, y, z: 0, invW, worldX: 0, worldY: 0, worldZ: 0 }) as const;
  const a = at(3, 5, 1),
    b = at(41, 9, 0.2),
    c = at(12, 37, 0.05);
  const [uva, uvb, uvc] = [
    [0, 0],
    [4, 0.5],
    [1, 6],
  ] as [number, number][];
  const uvAt = (x: number, y: number) => {
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    const wb = ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / area;
    const wc = ((y - a.y) * (b.x - a.x) - (x - a.x) * (b.y - a.y)) / area;
    const q = [(1 - wb - wc) * a.invW, wb * b.invW, wc * c.invW];
    const sum = q[0]! + q[1]! + q[2]!;
    return [0, 1].map((k) => (q[0]! * uva[k]! + q[1]! * uvb[k]! + q[2]! * uvc[k]!) / sum);
  };
  const [x, y, h] = [15.5, 14.5, 1e-4];
  const d = uvDerivatives(a, b, c, uva, uvb, uvc, x, y);
  const dx = [0, 1].map((k) => (uvAt(x + h, y)[k]! - uvAt(x - h, y)[k]!) / (2 * h));
  const dy = [0, 1].map((k) => (uvAt(x, y + h)[k]! - uvAt(x, y - h)[k]!) / (2 * h));
  for (const [got, want] of [
    [d.duDx, dx[0]],
    [d.dvDx, dx[1]],
    [d.duDy, dy[0]],
    [d.dvDy, dy[1]],
  ] as [number, number][]) {
    assert.ok(Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want)), `${got} vs ${want}`);
  }
});
