// A page is drawn where the shading reads it: the page's own projection, landing on its physical
// page, puts every world point on the texel and at the depth the shading's page addressing
// computes for it (`packages/sdk-browser/src/lighting/direct/shadowFactorWgsl.ts`), for a sun
// level page and for a lamp face page alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSunLevels } from './sunLevels.ts';
import { writeSunSquare } from './sunFaces.ts';
import { writeFace, writeLampPage } from './faces.ts';
import { SHADOW_PAGE, lampPagesAt, sunPageMetres } from './virtual.ts';
import type { SceneLight } from '../light/contracts.ts';
import { VIEW } from './lightShadow.fixture.ts';

const matrix = new Float32Array(16);
/** Clip coordinates of `p` under the column-major `m`. */
const clipOf = (m: Float32Array, p: number[]) =>
  [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
/** Texel of a page the viewport lands `clip` on, and its depth. */
const pageTexel = (clip: number[]) => [
  ((clip[0] / clip[3] + 1) / 2) * SHADOW_PAGE,
  ((1 - clip[1] / clip[3]) / 2) * SHADOW_PAGE,
  clip[2] / clip[3],
];

test("a sun page's projection puts a point on the texel and depth the shading reads it at", () => {
  const sun = createSunLevels(),
    axis = [0.3, -0.9, 0.2];
  const norm = Math.hypot(...axis);
  sun.update(
    0,
    axis.map((a) => a / norm),
    VIEW,
    [-40, -2, -40],
    [40, 12, 40],
    1,
  );
  const [right, up, forward] = [0, 3, 6].map((o) => [...sun.frame.subarray(o, o + 3)]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const level of [sun.finest[0] + 1, sun.finest[0] + 7]) {
    const texel = 2 ** level,
      page = sunPageMetres(level);
    for (const p of [
      [1.3, 0.2, -2.7],
      [-12.1, 4.4, 9.9],
      [0.01, 0, 0.02],
    ]) {
      // The shading: texel coordinates from the frame, the page they fall in.
      const u = dot(p, right) / texel,
        v = -dot(p, up) / texel;
      const ax = Math.floor(u / SHADOW_PAGE),
        ay = Math.floor(v / SHADOW_PAGE);
      writeSunSquare(matrix, 0, null, 0, sun, 0, level, ax, ay);
      const [x, y, depth] = pageTexel(clipOf(matrix, p));
      const zNear = sun.depth[0],
        range = sun.depth[1] - zNear;
      assert.ok(Math.abs(x - (u - ax * SHADOW_PAGE)) < 1e-2, `level ${level} x ${x} for ${p}`);
      assert.ok(Math.abs(y - (v - ay * SHADOW_PAGE)) < 1e-2, `level ${level} y ${y} for ${p}`);
      assert.ok(Math.abs(depth - (1 - (dot(p, forward) - zNear) / range)) < 1e-5);
      assert.ok(page > 0);
    }
  }
});

test("a lamp page's projection is its face's, cropped: same texel, same depth", () => {
  const lamp: SceneLight = {
    id: 'lamp',
    kind: 'point',
    position: [1, 3, -2],
    color: [1, 1, 1],
    intensity: 1,
    range: 15,
    castsShadow: true,
  };
  const face = new Float32Array(16);
  for (const p of [
    [2.2, 0.4, -1.5],
    [1.6, 1.1, -3.9],
    [4, -2, -2.5],
  ])
    for (let f = 0; f < 6; f++)
      for (const mip of [0, 3]) {
        writeFace(face, 0, null, 0, lamp, f);
        const clip = clipOf(face, p);
        if (clip[3] <= 0 || Math.abs(clip[0] / clip[3]) > 1 || Math.abs(clip[1] / clip[3]) > 1)
          continue;
        const side = lampPagesAt(mip) * SHADOW_PAGE;
        const tx = (clip[0] / clip[3] / 2 + 0.5) * side,
          ty = (0.5 - clip[1] / clip[3] / 2) * side;
        const x = Math.floor(tx / SHADOW_PAGE),
          y = Math.floor(ty / SHADOW_PAGE);
        writeLampPage(matrix, 0, null, 0, lamp, f, mip, x, y);
        const [px, py, depth] = pageTexel(clipOf(matrix, p));
        assert.ok(Math.abs(px - (tx - x * SHADOW_PAGE)) < 2e-2, `face ${f} mip ${mip} x`);
        assert.ok(Math.abs(py - (ty - y * SHADOW_PAGE)) < 2e-2, `face ${f} mip ${mip} y`);
        assert.ok(Math.abs(depth - clip[2] / clip[3]) < 1e-6);
      }
});
