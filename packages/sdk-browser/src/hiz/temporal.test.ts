import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { compareImages } from '../../../sdk-core/src/index.ts';
import { type VisPage } from '../visibility/buffer.ts';
import { shadeVisibility } from '../../../../bench/oracles/browser/cpu-image/shade.ts';
import { applyTemporalHiz, type HizPage, type TemporalHizState } from './hiz.ts';
import { buildHizPyramid } from './depth.ts';
import { filterUnoccluded } from './unoccluded.ts';
import { visibilityDepth } from './visibilityDepth.fixture.ts';
import { splitOccludersInto } from './split.ts';
import { cameraAt, quad } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { identityLocations } from '../page/selection/placements.fixture.ts';
import { rasterVisibilityIds } from '../../../../bench/oracles/browser/cpu-image/raster.ts';

test('Hi-Z remaining pages are a subset of the selected cut and never punch a beauty hole', () => {
  const frontMat = G.basicSurface({ color: 0xff0000 });
  const backMat = G.basicSurface({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const selected = [front.page, back.page];
  const occluders: (VisPage & HizPage)[] = [],
    rest: (VisPage & HizPage)[] = [],
    occludersPacked: number[] = [],
    restPacked: number[] = [];
  splitOccludersInto(
    selected,
    identityLocations(selected.length),
    cameraMoteur(cam),
    size,
    occluders,
    rest,
    occludersPacked,
    restPacked,
  );
  assert.deepEqual(
    occluders.map((page) => page.url),
    ['front'],
  );
  assert.deepEqual(
    rest.map((page) => page.url),
    ['back'],
  );
  const ids = rasterVisibilityIds(
    occluders,
    identityLocations(occluders.length),
    cameraMoteur(cam),
    size,
  );
  const remaining = filterUnoccluded(
    selected,
    identityLocations(selected.length),
    buildHizPyramid(
      visibilityDepth(ids, occluders, identityLocations(occluders.length), cameraMoteur(cam), size),
      32,
      32,
    ),
    cameraMoteur(cam),
    size,
    [],
  );
  assert.ok(remaining.every((page) => selected.includes(page)));
  const full = shadeVisibility(
    rasterVisibilityIds(selected, identityLocations(selected.length), cameraMoteur(cam), size),
    selected,
    identityLocations(selected.length),
    cameraMoteur(cam),
    size,
  );
  const filtered = shadeVisibility(
    rasterVisibilityIds(remaining, identityLocations(remaining.length), cameraMoteur(cam), size),
    remaining,
    identityLocations(remaining.length),
    cameraMoteur(cam),
    size,
  );
  assert.equal(compareImages(full, filtered).maxChannelError, 0);
  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});

test('temporal Hi-Z reprojects previous depth pyramid and handles disocclusion smoothly', () => {
  const frontMat = G.basicSurface({ color: 0xff0000 });
  const backMat = G.basicSurface({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const size: [number, number] = [32, 32];
  const history: TemporalHizState = {};

  // Frame 0: Front directly occludes back. History is populated.
  const cam0 = cameraAt(5);
  const res0 = applyTemporalHiz(
    [front.page, back.page],
    identityLocations(2),
    cameraMoteur(cam0),
    size,
    history,
  );
  assert.deepEqual(
    res0.shown.map((p) => p.url),
    ['front'],
  );
  assert.equal(res0.hizRejected, 1);
  assert.ok(history.pyramid);
  assert.ok(history.camera);

  // Frame 1: Same camera pose. Front remains occluder, back remains rejected.
  const res1 = applyTemporalHiz(
    [front.page, back.page],
    identityLocations(2),
    cameraMoteur(cam0),
    size,
    history,
  );
  assert.deepEqual(
    res1.shown.map((p) => p.url),
    ['front'],
  );
  assert.equal(res1.hizRejected, 1);

  // Frame 2: Camera shifts to the side so back is no longer occluded by front.
  const cam2 = G.perspectiveCamera(55, 1, 0.1, 100);
  cam2.position.set(5, 0, 2);
  cam2.lookAt(0, 0, -1);
  cam2.updateMatrixWorld();
  const res2 = applyTemporalHiz(
    [front.page, back.page],
    identityLocations(2),
    cameraMoteur(cam2),
    size,
    history,
  );
  // Both front and back should be shown now (disoccluded!)
  assert.ok(res2.shown.some((p) => p.url === 'back'));
  assert.ok(res2.shown.some((p) => p.url === 'front'));
  assert.equal(res2.hizRejected, 0);

  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});
