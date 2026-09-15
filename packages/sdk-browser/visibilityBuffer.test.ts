import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { opaqueBackgroundRgba } from './pageRaster.ts';
import {
  packVisibilityId,
  unpackVisibilityId,
  rasterVisibilityIds,
  shadeVisibility,
  VIS_INVALID,
  VIS_MAX_PAGES,
  VIS_MAX_PAGE_TRIANGLES,
  VIS_TRIANGLE_MASK,
  assertVisibilityPageTriangles,
  SHADE_SHADER,
} from './visibilityBuffer.ts';
import { camera, quadPages, centerId } from './visibilityBufferFixture.ts';

test('the WebGPU display buffer starts with the shared opaque scene background', () => {
  assert.deepEqual([...opaqueBackgroundRgba(2, 1)], [0x17, 0x1d, 0x28, 255, 0x17, 0x1d, 0x28, 255]);
});

test('SHADE_SHADER implements mat3 inverse-transpose without the missing WGSL inverse builtin', () => {
  assert.match(SHADE_SHADER, /fn inverseTranspose3\s*\(/);
  assert.doesNotMatch(SHADE_SHADER, /\binverse\s*\(/);
});

test('SHADE_SHADER early returns on background or invalid pixels before texture sampling', () => {
  const fs = SHADE_SHADER.slice(SHADE_SHADER.indexOf('fn shade_fs'));
  const firstReturn = fs.indexOf('return');
  // Les lectures d'atlas passent par `colorSample` et `dataSample`, déclarés avant `shade_fs` :
  // ce qui compte reste qu'aucune ne soit atteinte avant la sortie sur pixel de fond ou invalide.
  const sampleAt = fs.indexOf('colorSample(');
  assert.ok(firstReturn >= 0 && sampleAt >= 0);
  assert.ok(firstReturn < sampleAt);
});

test('CPU visibility shading uses the host background when no triangle is visible', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const { pages, geometry } = quadPages(material);
  const cam = camera(),
    size: [number, number] = [4, 4],
    ids = new Uint32Array(16);
  const image = shadeVisibility(ids, pages, cam, size, 0x2d4059);
  assert.deepEqual([...image.slice(0, 4)], [0x2d, 0x40, 0x59, 255]);
  geometry.dispose();
  material.dispose();
});

test('visibility ids pack a page and triangle and reserve 0 for the background', () => {
  assert.equal(unpackVisibilityId(VIS_INVALID), null);
  assert.deepEqual(unpackVisibilityId(packVisibilityId(0, 0)), { pageIndex: 0, triangleIndex: 0 });
  assert.deepEqual(unpackVisibilityId(packVisibilityId(2, 7)), { pageIndex: 2, triangleIndex: 7 });
  assert.notEqual(packVisibilityId(0, 1), packVisibilityId(1, 0));
  assert.throws(() => packVisibilityId(-1, 0));
});

test('a visibility id addresses 16.7 M pages and refuses a page of more than 256 triangles', () => {
  // Eight bits of triangle, twenty-four of page: a scene replicated nine times needs 394 254 rows,
  // far past the 65 535 a 16/16 split allowed.
  assert.equal(VIS_MAX_PAGE_TRIANGLES, 256);
  assert.ok(VIS_MAX_PAGES >= 9 * 43806);
  for (const page of [0, 1, 65535, 65536, 394253, VIS_MAX_PAGES - 1]) {
    for (const triangle of [0, 1, 127, VIS_TRIANGLE_MASK]) {
      const id = packVisibilityId(page, triangle);
      assert.ok(id > 0 && id <= 0xffffffff, `id out of range for ${page}/${triangle}`);
      assert.deepEqual(
        unpackVisibilityId(id),
        { pageIndex: page, triangleIndex: triangle },
        `${page}/${triangle}`,
      );
    }
  }
  // Neighbouring rows must never share an identifier.
  assert.equal(packVisibilityId(1, 0) - packVisibilityId(0, VIS_TRIANGLE_MASK), 1);
  assert.throws(() => packVisibilityId(VIS_MAX_PAGES, 0), /VISIBILITY_ID_RANGE/);
  assert.throws(() => packVisibilityId(0, VIS_MAX_PAGE_TRIANGLES), /VISIBILITY_ID_RANGE/);
  assert.equal(assertVisibilityPageTriangles(VIS_MAX_PAGE_TRIANGLES), VIS_MAX_PAGE_TRIANGLES);
  assert.throws(
    () => assertVisibilityPageTriangles(VIS_MAX_PAGE_TRIANGLES + 1, 'cluster.bin'),
    /VISIBILITY_PAGE_TRIANGLES: 257 .*cluster\.bin/,
  );
});

test('visibility ids are stable for the same pose and differ per triangle', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const { pages, geometry } = quadPages(material);
  const cam = camera(),
    size: [number, number] = [32, 32];
  const a = rasterVisibilityIds(pages, cam, size),
    b = rasterVisibilityIds(pages, cam, size);
  assert.deepEqual(a, b);
  const id = centerId(a, 32, 32);
  assert.notEqual(id, VIS_INVALID);
  const unpacked = unpackVisibilityId(id)!;
  assert.ok(unpacked.pageIndex === 0 || unpacked.pageIndex === 1);
  assert.equal(unpacked.triangleIndex, 0);
  const ids = new Set(a.filter((v) => v !== VIS_INVALID));
  assert.equal(ids.size, 2);
  const clusters = new Set([...ids].map((v) => pages[unpackVisibilityId(v)!.pageIndex].clusterId));
  assert.equal(clusters.size, 2);
  geometry.dispose();
  material.dispose();
});
