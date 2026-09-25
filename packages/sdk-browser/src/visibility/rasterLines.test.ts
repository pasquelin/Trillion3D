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

const VIEW: [number, number] = [96, 96];

/** One segment from (−1, 0, 0) to (1, 0, 0) as `drawn.ts` quads it: every corner on an endpoint,
 *  its normal the signed direction. */
function segment(lineWidth: number): VisPage {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([-1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  geometry.setAttribute('normal', G.floatAttribute([1, 0, 0, -1, 0, 0, 1, 0, 0, -1, 0, 0], 3));
  return {
    array: new Uint32Array([0, 1, 3, 0, 3, 2]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(G.basicSurface({ side: G.DOUBLE_SIDE, lineWidth })),
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
