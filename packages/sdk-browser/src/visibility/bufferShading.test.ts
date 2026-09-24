import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { compareImages } from '../../../sdk-core/src/index.ts';
import { rasterPages } from '../page/raster.ts';
import {
  unpackVisibilityId,
  rasterVisibilityIds,
  shadeVisibility,
  visibilityUvDerivatives,
  VIS_INVALID,
  type VisPage,
} from './buffer.ts';
import { camera, quadPages, centerId, nearestQuadTexture } from './buffer.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';

test('the closer triangle wins the visibility id when two pages overlap', () => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 1, 1, -1, 1, 1, 1, 1], 3),
  );
  const farMat = G.basicSurface({ color: 0xff0000 }),
    nearMat = G.basicSurface({ color: 0x00ff00 });
  const far: VisPage = {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(farMat),
    clusterId: 'far',
  };
  const near: VisPage = {
    array: new Uint32Array([3, 4, 5]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(nearMat),
    clusterId: 'near',
  };
  const cam = camera(),
    ids = rasterVisibilityIds([far, near], cameraMoteur(cam), [32, 32]);
  const unpacked = unpackVisibilityId(centerId(ids, 32, 32));
  assert.deepEqual(unpacked, { pageIndex: 1, triangleIndex: 0 });
  geometry.dispose();
  farMat.dispose();
  nearMat.dispose();
});

test('visbuffer beauty for untextured MeshBasicMaterial matches the documented rasterPages reference', () => {
  const material = G.basicSurface({ color: 0xff0000 });
  const { pages, geometry } = quadPages(material);
  const cam = camera(),
    size: [number, number] = [32, 32];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  const beauty = shadeVisibility(ids, pages, cameraMoteur(cam), size);
  const expected = rasterPages(pages, cam, size);
  const image = compareImages(expected, beauty);
  assert.equal(image.maxChannelError, 0);
  geometry.dispose();
  material.dispose();
});

test('the second pass samples the source map at reconstructed UVs', () => {
  const map = nearestQuadTexture();
  const material = G.basicSurface({ color: 0xffffff, map });
  const { pages, geometry } = quadPages(material, [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  const beauty = shadeVisibility(ids, pages, cameraMoteur(cam), size);
  const id = centerId(ids, 16, 16);
  assert.notEqual(id, VIS_INVALID);
  const o = (((16 / 2) | 0) * 16 + ((16 / 2) | 0)) * 4;
  assert.equal(beauty[o], 255);
  assert.equal(beauty[o + 1], 0);
  assert.equal(beauty[o + 2], 0);
  const untextured = G.basicSurface({ color: 0xffffff });
  const white = shadeVisibility(
    ids,
    pages.map((page) => ({ ...page, material: surfaceOf(untextured) })),
    cameraMoteur(cam),
    size,
  );
  assert.ok(compareImages(beauty, white).maxChannelError > 0);
  geometry.dispose();
  material.dispose();
  untextured.dispose();
  map.dispose();
});

test('UV derivatives come from the winning triangle, not a neighbour across a visbuffer seam', () => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setAttribute('uv', G.floatAttribute([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 2));
  const material = G.basicSurface({ color: 0xffffff });
  const pages: VisPage[] = [
    {
      array: new Uint32Array([0, 1, 2]),
      attributes: geometry.attributes,
      matrix: new G.Matrix4(),
      material: surfaceOf(material),
      clusterId: 'left',
    },
    {
      array: new Uint32Array([3, 4, 5]),
      attributes: geometry.attributes,
      matrix: new G.Matrix4(),
      material: surfaceOf(material),
      clusterId: 'right',
    },
  ];
  const cam = camera(),
    size: [number, number] = [32, 32];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  let left: { x: number; y: number } | undefined, right: { x: number; y: number } | undefined;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const unpacked = unpackVisibilityId(ids[y * 32 + x]);
      if (!unpacked) continue;
      if (unpacked.pageIndex === 0 && !left) left = { x, y };
      if (unpacked.pageIndex === 1) right = { x, y };
    }
  assert.ok(left && right);
  const dLeft = visibilityUvDerivatives(ids, pages, cameraMoteur(cam), size, left!.x, left!.y)!;
  const dRight = visibilityUvDerivatives(ids, pages, cameraMoteur(cam), size, right!.x, right!.y)!;
  assert.ok(Math.hypot(dLeft.duDx, dLeft.dvDx, dLeft.duDy, dLeft.dvDy) < 1e-5);
  assert.ok(Math.hypot(dRight.duDx, dRight.dvDx, dRight.duDy, dRight.dvDy) < 1e-5);
  geometry.dispose();
  material.dispose();
});
