// #348: the CPU software raster — the temporal Hi-Z depth and the oracles `rasterRgba` and
// `visibilityIds` — draws a line quad as every GPU raster does, with the one formula
// (`lineClip`, `./shader/lineWgsl.ts`), `linewidth` in CSS pixels times the pixel ratio.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { rasterVisibility } from './raster.ts';
import { triangleAt } from './projection.ts';
import type { VisPage } from './types.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';
import { lineDash } from './shader/lineWgsl.ts';

const VIEW: [number, number] = [96, 96];

/** One segment from (−1, 0, 0) to (1, 0, 0) as `drawn.ts` quads it: every corner on an endpoint,
 *  its normal the signed direction; `dash`, a dashed line's, its distance along the line in `uv`. */
function segment(lineWidth: number, dash?: { dashSize: number; gapSize: number }): VisPage {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([-1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  geometry.setAttribute('normal', G.floatAttribute([1, 0, 0, -1, 0, 0, 1, 0, 0, -1, 0, 0], 3));
  if (dash) geometry.setAttribute('uv', G.floatAttribute([0, 0, 0, 0, 2, 0, 2, 0], 2));
  return {
    array: new Uint32Array([0, 1, 3, 0, 3, 2]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(G.basicSurface({ side: G.DOUBLE_SIDE, lineWidth, ...dash })),
  };
}

function camera() {
  const cam = G.perspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cameraMoteur(cam);
}

test('the CPU raster widens a line corner by the CSS width times the pixel ratio', () => {
  for (const pixelRatio of [1, 2]) {
    const tri = triangleAt(segment(3), 0, camera(), VIEW[0], VIEW[1], pixelRatio)!;
    // Corners 0 and 1 are the two sides of the first endpoint.
    const gap = Math.hypot(tri.a.x - tri.b.x, tri.a.y - tri.b.y);
    assert.ok(Math.abs(gap - 3 * pixelRatio) < 1e-9, `ratio ${pixelRatio}: ${gap}`);
  }
});

test('the CPU raster covers a line with its width, where it drew nothing before', () => {
  for (const pixelRatio of [1, 2]) {
    const { ids } = rasterVisibility([segment(3)], camera(), VIEW, pixelRatio);
    let covered = 0;
    for (let y = 0; y < VIEW[1]; y++) if (ids[y * VIEW[0] + 48]) covered++;
    // The rows whose centre falls within the band, both edges inclusive.
    assert.ok(covered >= 3 * pixelRatio && covered <= 3 * pixelRatio + 1, `${covered} rows`);
  }
  const { ids } = rasterVisibility([segment(0)], camera(), VIEW);
  assert.equal(ids.filter(Boolean).length, 0, 'a triangle surface of this quad has no area');
});

// #359: the CPU raster cuts a dashed line's gaps with the shared dash (`lineDash`), at the distance
// along the line its quads carry: drawn on each dash, empty on each gap; a solid line stays whole.
test('the CPU raster draws a dashed line on its dashes and leaves its gaps empty', () => {
  const row = (page: VisPage) => {
    const { ids } = rasterVisibility([page], camera(), VIEW);
    return Array.from({ length: VIEW[0] }, (_, x) => ids[48 * VIEW[0] + x] !== 0);
  };
  const solid = row(segment(3));
  const first = solid.indexOf(true),
    last = solid.lastIndexOf(true);
  assert.ok(last - first > 20 && solid.slice(first, last + 1).every(Boolean), 'solid: whole');
  const dash = { dashSize: 0.3, gapSize: 0.2 };
  const dashed = row(segment(3, dash));
  // The distance along the line of a pixel centre, from the ends the solid line covers.
  const perPixel = 2 / (last + 1 - first);
  let on = 0,
    off = 0;
  for (let x = first; x <= last; x++) {
    const at = (x + 0.5 - first) * perPixel,
      phase = at % 0.5;
    // A pixel whose centre sits within a pixel of a dash's end may fall either way.
    if (Math.min(phase, Math.abs(phase - 0.3), 0.5 - phase) < perPixel) continue;
    assert.equal(dashed[x], lineDash(at, dash.dashSize, dash.gapSize), `pixel ${x} at ${at}`);
    if (dashed[x]) on++;
    else off++;
  }
  assert.ok(on > 8 && off > 3, `${on} drawn, ${off} empty`);
  assert.ok(
    dashed.slice(0, first).every((v) => !v),
    'nothing outside the line',
  );
});
