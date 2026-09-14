import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { rasterVisibilityIds, shadeVisibility } from './visibilityBuffer.ts';
import {
  HIZ_BOUNDS_VALUES,
  buildHizPyramid,
  createBoxCorners,
  filterUnoccluded,
  projectBoxToScreen,
  projectBoxesFlat,
  splitOccluders,
  splitOccludersFlat,
  visibilityDepth,
  applyTemporalHiz,
  type HizPage,
  type TemporalHizState,
} from './hiz.ts';
import { cameraAt, quad } from '../../test/fixtures/hiz.ts';

test('Hi-Z remaining pages are a subset of the selected cut and never punch a beauty hole', () => {
  const frontMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const backMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const selected = [front.page, back.page];
  const { occluders, rest } = splitOccluders(selected, cam, size);
  assert.deepEqual(
    occluders.map((page) => page.url),
    ['front'],
  );
  assert.deepEqual(
    rest.map((page) => page.url),
    ['back'],
  );
  const ids = rasterVisibilityIds(occluders, cam, size);
  const remaining = filterUnoccluded(
    selected,
    buildHizPyramid(visibilityDepth(ids, occluders, cam, size), 32, 32),
    cam,
    size,
  );
  assert.ok(remaining.every((page) => selected.includes(page)));
  const full = shadeVisibility(rasterVisibilityIds(selected, cam, size), selected, cam, size);
  const filtered = shadeVisibility(rasterVisibilityIds(remaining, cam, size), remaining, cam, size);
  assert.equal(compareImages(full, filtered).maxChannelError, 0);
  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});

test('temporal Hi-Z reprojects previous depth pyramid and handles disocclusion smoothly', () => {
  const frontMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const backMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const size: [number, number] = [32, 32];
  const history: TemporalHizState = {};

  // Frame 0: Front directly occludes back. History is populated.
  const cam0 = cameraAt(5);
  const res0 = applyTemporalHiz([front.page, back.page], cam0, size, history);
  assert.deepEqual(
    res0.shown.map((p) => p.url),
    ['front'],
  );
  assert.equal(res0.hizRejected, 1);
  assert.ok(history.pyramid);
  assert.ok(history.camera);

  // Frame 1: Same camera pose. Front remains occluder, back remains rejected.
  const res1 = applyTemporalHiz([front.page, back.page], cam0, size, history);
  assert.deepEqual(
    res1.shown.map((p) => p.url),
    ['front'],
  );
  assert.equal(res1.hizRejected, 1);

  // Frame 2: Camera shifts to the side so back is no longer occluded by front.
  const cam2 = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam2.position.set(5, 0, 2);
  cam2.lookAt(0, 0, -1);
  cam2.updateMatrixWorld();
  const res2 = applyTemporalHiz([front.page, back.page], cam2, size, history);
  // Both front and back should be shown now (disoccluded!)
  assert.ok(res2.shown.some((p) => p.url === 'back'));
  assert.ok(res2.shown.some((p) => p.url === 'front'));
  assert.equal(res2.hizRejected, 0);

  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});

test('flat projection and split reproduce the object forms to the bit, including depth ties', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const pages: HizPage[] = [];
  for (let i = 0; i < 300; i++) {
    const centre = [rnd() * 20 - 10, rnd() * 20 - 10, -rnd() * 40],
      half = [rnd() * 2 + 0.01, rnd() * 2 + 0.01, rnd() * 2 + 0.01];
    const matrix = new THREE.Matrix4()
      .makeRotationY(rnd() * 6)
      .setPosition(rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 4 - 2);
    pages.push({
      min: centre.map((value, axis) => value - half[axis]),
      max: centre.map((value, axis) => value + half[axis]),
      matrix,
    });
  }
  // Copies of existing boxes give the sort exactly equal depths, where the index tie-break decides.
  for (let i = 0; i < 30; i++) pages.push({ ...pages[i] });
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  camera.position.set(1, 2, 3);
  camera.lookAt(0, 0, -20);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const viewport: [number, number] = [1280, 720];
  const flat = new Float64Array(pages.length * HIZ_BOUNDS_VALUES);
  projectBoxesFlat(pages, pages.length, camera, viewport, flat);
  for (let i = 0; i < pages.length; i++) {
    const reference = projectBoxToScreen(
        pages[i].min,
        pages[i].max,
        pages[i].matrix,
        camera,
        viewport,
      ),
      base = i * HIZ_BOUNDS_VALUES;
    assert.equal(flat[base + 5] !== 0, reference.clipsNear);
    if (reference.clipsNear) continue;
    assert.deepEqual(
      [flat[base], flat[base + 1], flat[base + 2], flat[base + 3], flat[base + 4]],
      [reference.minX, reference.minY, reference.maxX, reference.maxY, reference.nearestDepth],
    );
  }
  // The same rectangles when the world corners are kept across images, including a second image that
  // reads the cache instead of rebuilding it: a hoisted corner is the same double, not a rounded one.
  const corners = createBoxCorners(pages.length),
    pageIndex = new Int32Array(pages.length).map((_, index) => index);
  const cached = new Float64Array(flat.length);
  for (const pass of [0, 1]) {
    cached.fill(0);
    projectBoxesFlat(pages, pages.length, camera, viewport, cached, undefined, {
      corners,
      pageIndex,
      epoch: 1,
    });
    assert.deepEqual([...cached], [...flat], `image ${pass} avec coins gardés`);
  }
  const rest = new Uint8Array(pages.length),
    occluders = splitOccludersFlat(pages.length, flat, rest);
  const tagged = pages.map((page, index) => ({ ...page, tag: index }));
  const reference = splitOccluders(tagged, camera, viewport);
  assert.equal(occluders, reference.occluders.length);
  const referenceOccluders = new Set(reference.occluders.map((page) => page.tag));
  for (let i = 0; i < pages.length; i++)
    assert.equal(rest[i] === 0, referenceOccluders.has(i), `page ${i}`);
});
