// The cluster error metric follows the viewport: the focal in pixels is the viewport's, so a
// viewport half as high projects every error half as far, and the cut at 1248×702 under a
// threshold of one pixel is the cut at 2496×1404 under two. Measured on Emerald Square, sol and
// generale views, one triangle count on both sides (#11); proved here at the formula site.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { maxStretch } from '../../../sdk-core/src/index.ts';
import { cameraSelectionUniforms } from '../gpu/core/selection.ts';
import { clusterPixels, projectedClusterError } from '../page/selection/math.ts';
import { drawsCluster } from '../page/cut/rule.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';

const FULL: [number, number] = [2496, 1404],
  HALF: [number, number] = [1248, 702];

function camera() {
  const cam = G.perspectiveCamera(55, FULL[0] / FULL[1], 0.05, 2000);
  cam.position.set(3, 1.6, 7);
  cam.lookAt(-4, 1, -20);
  cam.updateMatrixWorld(true);
  return cameraMoteur(cam);
}

/** Focal in pixels of the selection uniforms, the operand the kernel and the CPU cut project with. */
const focalOf = (viewport: [number, number]) => {
  const { pixelScale } = cameraSelectionUniforms(camera(), 1, viewport);
  return Math.max(pixelScale[0], pixelScale[1]);
};

test('a viewport half as high projects every cluster error exactly half as far', () => {
  const cam = camera(),
    e = cam.viewRelative,
    stretch = maxStretch(e);
  const full = focalOf(FULL),
    half = focalOf(HALF);
  assert.equal(half, full / 2);
  let compared = 0;
  for (let i = 0; i < 200; i++) {
    const sphere = [Math.sin(i) * 12, Math.cos(i * 0.7) * 3, -2 - i * 0.4, 0.2 + (i % 7) * 0.3];
    const error = 0.001 * (1 + (i % 11));
    const atFull = projectedClusterError(error, sphere, 0, e, stretch, full, cam.near),
      atHalf = projectedClusterError(error, sphere, 0, e, stretch, half, cam.near);
    if (!Number.isFinite(atFull)) continue;
    assert.equal(atHalf, atFull / 2, `cluster ${i}`);
    compared++;
  }
  assert.ok(compared > 150, 'the sample mostly lies in front of the near plane');
});

test('the cut at half the viewport under one pixel is the cut at the full viewport under two', () => {
  const cam = camera(),
    e = cam.viewRelative,
    stretch = maxStretch(e);
  const full = focalOf(FULL),
    half = focalOf(HALF);
  let selectedAtHalf = 0;
  for (let i = 0; i < 400; i++) {
    const depth = 1 + (i % 40) * 0.9,
      radius = 0.3 + (i % 5) * 0.2;
    const rec = {
      sphere: [((i % 9) - 4) * depth * 0.1, ((i % 4) - 2) * depth * 0.1, -depth, radius],
      lodError: radius * 0.002 * (1 + (i % 3)),
      parentError: radius * 0.01 * (1 + (i % 6)),
      parentSphere: null,
    };
    const selects = (focal: number, threshold: number) => {
      const [own, parent] = clusterPixels(rec, e, stretch, focal, cam.near, 1, new Float64Array(2));
      return drawsCluster(true, parent, own, true, threshold);
    };
    const atHalf = selects(half, 1),
      atFull = selects(full, 2);
    assert.equal(atHalf, atFull, `cluster ${i}`);
    if (atHalf) selectedAtHalf++;
  }
  assert.ok(selectedAtHalf > 0 && selectedAtHalf < 400, 'the sample straddles the threshold');
});
