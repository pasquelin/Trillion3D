import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BACKGROUND } from '../sdk-core/index.ts';
import { rasterVisibilityIds } from './visibilityBuffer.ts';
import {
  buildHizPyramid,
  filterUnoccluded,
  hizRejects,
  projectBoxToScreen,
  sameHizView,
  splitOccluders,
  visibilityDepth,
} from './hiz.ts';
import { cameraAt, quad } from '../../test/fixtures/hiz.ts';

test('Hi-Z history is invalidated by camera motion and projection cuts', () => {
  const previous = cameraAt(),
    current = previous.clone();
  assert.equal(sameHizView(previous, current), true);
  current.position.x = 1;
  current.updateMatrixWorld();
  assert.equal(sameHizView(previous, current), false);
  current.position.x = 0;
  current.fov = 75;
  current.updateProjectionMatrix();
  current.updateMatrixWorld();
  assert.equal(sameHizView(previous, current), false);
});

test('visibility depth after the visbuffer uses background 1 and closer-wins z', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const { page, geometry } = quad(material, [-1, -1, 0], [1, 1, 0], 'front');
  const cam = cameraAt(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds([page], cam, size);
  const depth = visibilityDepth(ids, [page], cam, size);
  assert.equal(depth.length, 16 * 16);
  const center = depth[((16 / 2) | 0) * 16 + ((16 / 2) | 0)];
  assert.ok(center < 1);
  assert.ok(center > 0);
  let background = 0;
  for (let i = 0; i < depth.length; i++)
    if (ids[i] === 0) {
      assert.equal(depth[i], HIZ_BACKGROUND);
      background++;
    }
  assert.ok(background > 0);
  geometry.dispose();
  material.dispose();
});

test('a box that crosses the near plane is never Hi-Z rejected', () => {
  const cam = cameraAt(0.5, 0.1);
  const bounds = projectBoxToScreen([-2, -2, -2], [2, 2, 2], new THREE.Matrix4(), cam, [32, 32]);
  assert.equal(bounds.clipsNear, true);
  const depth = new Float32Array(32 * 32);
  depth.fill(0.2);
  const pyramid = buildHizPyramid(depth, 32, 32);
  assert.equal(hizRejects(pyramid, bounds), false);
});

test('the screen rectangle is rounded outward and a single background hole cannot hide', () => {
  const depth = new Float32Array(4);
  depth.set([0.2, 0.3, 0.4, 1]);
  const pyramid = buildHizPyramid(depth, 2, 2);
  const bounds = projectBoxToScreen(
    [-1, -1, 0],
    [1, 1, 0],
    new THREE.Matrix4(),
    cameraAt(),
    [2, 2],
  );
  assert.equal(bounds.clipsNear, false);
  assert.ok(bounds.minX <= 0 && bounds.minY <= 0);
  assert.ok(bounds.maxX >= 2 && bounds.maxY >= 2);
  assert.equal(hizRejects(pyramid, bounds), false);
});

test('an integer-edge screen max includes that pixel so a hole there cannot hide', () => {
  const depth = new Float32Array(16);
  depth.fill(0.2);
  depth[2 * 4 + 2] = 1;
  const pyramid = buildHizPyramid(depth, 4, 4);
  assert.equal(
    hizRejects(pyramid, {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
      nearestDepth: 0.8,
      clipsNear: false,
    }),
    false,
  );
});

test('pages that cross the near plane are not used as Hi-Z occluders', () => {
  const cam = cameraAt(0.5, 0.1);
  const crossing = quad(new THREE.MeshBasicMaterial(), [-2, -2, -2], [2, 2, 2], 'crossing');
  const far = quad(new THREE.MeshBasicMaterial(), [-0.2, -0.2, -2], [0.2, 0.2, -2], 'far');
  const { occluders, rest } = splitOccluders([crossing.page, far.page], cam, [16, 16]);
  assert.equal(
    occluders.some((page) => page.url === 'crossing'),
    false,
  );
  assert.ok(rest.some((page) => page.url === 'crossing'));
  crossing.geometry.dispose();
  far.geometry.dispose();
  crossing.page.material.dispose();
  far.page.material.dispose();
});

test('Hi-Z rejects a fully covered farther page and keeps a page beside a hole', () => {
  const frontMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const backMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const hole = quad(holeMat, [-1, -1, 0], [0, 1, 0], 'hole');
  const open = quad(backMat, [0.35, -0.2, -2], [0.8, 0.2, -2], 'open');
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const occluderIds = rasterVisibilityIds([front.page], cam, size);
  const occluderDepth = visibilityDepth(occluderIds, [front.page], cam, size);
  const pyramid = buildHizPyramid(occluderDepth, 32, 32);
  const selected = [front.page, back.page];
  const remaining = filterUnoccluded(selected, pyramid, cam, size);
  assert.deepEqual(
    remaining.map((page) => page.url),
    ['front'],
  );
  assert.ok(remaining.every((page) => selected.includes(page)));
  const holeIds = rasterVisibilityIds([hole.page], cam, size);
  const holePyramid = buildHizPyramid(visibilityDepth(holeIds, [hole.page], cam, size), 32, 32);
  const beside = filterUnoccluded([hole.page, open.page], holePyramid, cam, size);
  assert.ok(beside.some((page) => page.url === 'open'));
  front.geometry.dispose();
  back.geometry.dispose();
  hole.geometry.dispose();
  open.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
  holeMat.dispose();
});
