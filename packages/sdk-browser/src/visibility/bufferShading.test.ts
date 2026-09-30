import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { compareImages } from '../../../sdk-core/src/index.ts';
import {
  unpackVisibilityId,
  rasterVisibilityIds,
  shadeVisibility,
  type VisPage,
} from './buffer.ts';
import { camera, quadPages, centerId, nearestQuadTexture } from './buffer.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';
import { identityRoots } from '../page/selection/placements.fixture.ts';

const VIS_INVALID = 0;

test('the closer triangle wins the visibility id when two pages overlap', () => {
  const geometry = new G.Geometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 1, 1, -1, 1, 1, 1, 1], 3),
  );
  const farMat = G.basicSurface({ color: 0xff0000 }),
    nearMat = G.basicSurface({ color: 0x00ff00 });
  const far: VisPage = {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometry.attributes,
    placementIndex: 0,
    material: surfaceOf(farMat),
    clusterId: 'far',
  };
  const near: VisPage = {
    array: new Uint32Array([3, 4, 5]),
    attributes: geometry.attributes,
    placementIndex: 0,
    material: surfaceOf(nearMat),
    clusterId: 'near',
  };
  const cam = camera(),
    ids = rasterVisibilityIds([far, near], identityRoots(), cameraMoteur(cam), [32, 32]);
  const unpacked = unpackVisibilityId(centerId(ids, 32, 32));
  assert.deepEqual(unpacked, { pageIndex: 1, triangleIndex: 0 });
  geometry.dispose();
  farMat.dispose();
  nearMat.dispose();
});

test('the second pass samples the source map at reconstructed UVs', () => {
  const map = nearestQuadTexture();
  const material = G.basicSurface({ color: 0xffffff, map });
  const { pages, geometry } = quadPages(material, [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, identityRoots(), cameraMoteur(cam), size);
  const beauty = shadeVisibility(ids, pages, identityRoots(), cameraMoteur(cam), size);
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
    identityRoots(),
    cameraMoteur(cam),
    size,
  );
  assert.ok(compareImages(beauty, white).maxChannelError > 0);
  geometry.dispose();
  material.dispose();
  untextured.dispose();
  map.dispose();
});
