import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { rasterVisibilityIds } from '../visibility/buffer.ts';
import { buildHizPyramid, countUnoccluded, visibilityDepth } from './hiz.ts';
import { HIZ_TEST_VALUES, hizTestRect } from './occlusion.ts';
import { createHizCounts, HIZ_KERNEL_TEXELS } from './counts.ts';
import { cameraAt, quad } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';

test('hizTestRect clips rectangle to viewport: entirely inside', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(8, 8, 15, 15, false, 32, 32, 6, into);
  assert.equal(result, true);
  assert.equal(into[0], 0);
  assert.equal(into[1], 8);
  assert.equal(into[2], 8);
  assert.equal(into[3], 15);
  assert.equal(into[4], 15);
});

test('hizTestRect clips rectangle to viewport: overflowing right/bottom', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(16, 16, 40, 40, false, 32, 32, 6, into);
  assert.equal(result, true);
  assert.equal(into[1], 16);
  assert.equal(into[2], 16);
  assert.equal(into[3], 31);
  assert.equal(into[4], 31);
});

test('hizTestRect clips rectangle to viewport: overflowing left/top', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(-8, -8, 8, 8, false, 32, 32, 6, into);
  assert.equal(result, true);
  assert.equal(into[1], 0);
  assert.equal(into[2], 0);
  assert.equal(into[3], 8);
  assert.equal(into[4], 8);
});

test('hizTestRect rejects entirely outside viewport', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(40, 40, 50, 50, false, 32, 32, 6, into);
  assert.equal(result, false);
});

test('hizTestRect rejects rectangle entirely left of viewport', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(-16, 0, -1, 16, false, 32, 32, 6, into);
  assert.equal(result, false);
});

test('hizTestRect rejects near-plane crossing', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(8, 8, 15, 15, true, 32, 32, 6, into);
  assert.equal(result, false);
});

test('hizTestRect handles single-texel rectangle', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const result = hizTestRect(15, 15, 15, 15, false, 32, 32, 6, into);
  assert.equal(result, true);
  assert.equal(into[1], 15);
  assert.equal(into[2], 15);
  assert.equal(into[3], 15);
  assert.equal(into[4], 15);
});

test('hizTestRect selects coarser mip for large footprint', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const width = 33,
    height = 19;
  const result = hizTestRect(0, 0, width - 1, height - 1, false, width, height, 6, into);
  assert.equal(result, true);
  assert.ok(into[0] > 0);
  const mipScale = 2 ** into[0];
  const mipWidth = Math.floor((width - 1) / mipScale) - Math.floor(0 / mipScale);
  const mipHeight = Math.floor((height - 1) / mipScale) - Math.floor(0 / mipScale);
  assert.ok(mipWidth < HIZ_KERNEL_TEXELS);
  assert.ok(mipHeight < HIZ_KERNEL_TEXELS);
});

test('hizTestRect chooses finest mip whose footprint fits kernel', () => {
  const into = new Int32Array(HIZ_TEST_VALUES);
  const width = 64,
    height = 64;
  const result = hizTestRect(0, 0, width - 1, height - 1, false, width, height, 6, into);
  assert.equal(result, true);
  assert.equal(into[0], 2);
  const mipScale = 2 ** into[0];
  const mipWidth = Math.floor((width - 1) / mipScale) - Math.floor(0 / mipScale) + 1;
  const mipHeight = Math.floor((height - 1) / mipScale) - Math.floor(0 / mipScale) + 1;
  assert.equal(mipWidth, 16);
  assert.equal(mipHeight, 16);
});

test('counters: tested and kept account for all pages', () => {
  const frontMat = G.basicSurface({ color: 0xff0000 });
  const backMat = G.basicSurface({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const occluderIds = rasterVisibilityIds([front.page], cameraMoteur(cam), size);
  const occluderDepth = visibilityDepth(occluderIds, [front.page], cameraMoteur(cam), size);
  const pyramid = buildHizPyramid(occluderDepth, 32, 32);
  const counts = createHizCounts();
  const kept = countUnoccluded([front.page, back.page], pyramid, cameraMoteur(cam), size, counts);
  assert.equal(counts.tested, 2);
  assert.equal(counts.rejected + kept.length, counts.tested);
  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});

test('counters: triangle counts reflect cluster rejection', () => {
  const frontMat = G.basicSurface({ color: 0xff0000 });
  const backMat = G.basicSurface({ color: 0x00ff00 });
  const front = quad(frontMat, [-1, -1, 0], [1, 1, 0], 'front');
  const back = quad(backMat, [-0.2, -0.2, -2], [0.2, 0.2, -2], 'back');
  front.page.array = new Uint32Array(18);
  back.page.array = new Uint32Array(12);
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const occluderIds = rasterVisibilityIds([front.page], cameraMoteur(cam), size);
  const occluderDepth = visibilityDepth(occluderIds, [front.page], cameraMoteur(cam), size);
  const pyramid = buildHizPyramid(occluderDepth, 32, 32);
  const counts = createHizCounts();
  countUnoccluded([front.page, back.page], pyramid, cameraMoteur(cam), size, counts);
  assert.equal(counts.testedTriangles, 6 + 4);
  assert.equal(
    counts.rejectedTriangles + (counts.testedTriangles - counts.rejectedTriangles),
    counts.testedTriangles,
  );
  front.geometry.dispose();
  back.geometry.dispose();
  frontMat.dispose();
  backMat.dispose();
});

test('counters: oversized pages are counted separately', () => {
  const hugeMat = G.basicSurface({ color: 0xff0000 });
  const huge = quad(hugeMat, [-10, -10, -0.5], [10, 10, 0.5], 'huge');
  huge.page.array = new Uint32Array(24);
  const cam = cameraAt(),
    size: [number, number] = [32, 32];
  const depth = new Float32Array(32 * 32);
  depth.fill(0.5);
  const pyramid = buildHizPyramid(depth, 32, 32);
  const counts = createHizCounts();
  countUnoccluded([huge.page], pyramid, cameraMoteur(cam), size, counts);
  assert.equal(counts.tested, 1);
  assert.equal(counts.oversized, 1);
  assert.equal(counts.oversizedTriangles, 8);
  huge.geometry.dispose();
  hugeMat.dispose();
});
