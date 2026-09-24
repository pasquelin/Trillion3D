import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import {
  unpackVisibilityId,
  rasterVisibilityIds,
  shadeVisibility,
  VIS_SHADER,
  type VisPage,
} from './buffer.ts';
import { camera, quadPages, centerId } from './buffer.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { surfaceOf } from '../page/surface.ts';

test('MeshStandardMaterial pure metal retains the punctual specular highlight', () => {
  const metalMat = G.standardSurface({
    color: 0xffd700,
    metalness: 1.0,
    roughness: 0.1,
  });
  const { pages, geometry } = quadPages(metalMat);
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  const shaded = shadeVisibility(ids, pages, cameraMoteur(cam), size);
  const o = (((16 / 2) | 0) * 16 + ((16 / 2) | 0)) * 4;
  // The directional source still contributes a tinted specular highlight.
  assert.ok(shaded[o] > 0);
  assert.ok(shaded[o + 1] > 0);
  geometry.dispose();
  metalMat.dispose();
});

test('vis shader instances pages from the page table', () => {
  assert.match(VIS_SHADER, /@builtin\(instance_index\)/);
  assert.match(VIS_SHADER, /pages\s*:\s*array<PageInfo>/);
  assert.match(VIS_SHADER, /vertexIndex\s*>=\s*page\.indexCount/);
  assert.doesNotMatch(VIS_SHADER, /uni\.pageOffset/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(2\) var<storage,\s*read> pages/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(4\) var<uniform> uni/);
  assert.match(VIS_SHADER, /@group\(0\) @binding\(6\) var colorPool/);
  assert.match(VIS_SHADER, /fn maskKeep/);
  assert.match(VIS_SHADER, /discard;/);
  assert.match(VIS_SHADER, /textureSampleLevel/);
  assert.doesNotMatch(VIS_SHADER, /textureSample\s*\(/);
  assert.doesNotMatch(VIS_SHADER, /@group\(0\) @binding\(2\) var<uniform>/);
});

test('MASK alpha-test punches a visbuffer hole before shading', () => {
  const map = G.dataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 0, 0]),
    2,
    2,
    G.HOST_FORMAT_RGBA,
  );
  map.magFilter = G.HOST_FILTER_NEAREST;
  map.minFilter = G.HOST_FILTER_NEAREST;
  map.flipY = false;
  map.needsUpdate = true;
  const mask = G.basicSurface({ color: 0xffffff, map, alphaTest: 0.5 });
  const solid = G.basicSurface({ color: 0x00ff00 });
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    G.floatAttribute([0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0, 0, 1, 0, 1, 1, 0, 1], 2),
  );
  const far: VisPage = {
    array: new Uint32Array([0, 1, 2, 0, 2, 3]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(solid),
    clusterId: 'far',
  };
  const near: VisPage = {
    array: new Uint32Array([4, 5, 6, 4, 6, 7]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(mask),
    clusterId: 'near',
  };
  const cam = camera(),
    ids = rasterVisibilityIds([far, near], cameraMoteur(cam), [16, 16]);
  const unpacked = unpackVisibilityId(centerId(ids, 16, 16));
  assert.ok(unpacked);
  assert.equal(unpacked.pageIndex, 0);
  assert.notEqual(unpacked.pageIndex, 1);
  geometry.dispose();
  mask.dispose();
  solid.dispose();
  map.dispose();
});

test('standard-material irradiance matches the Three.js linear capture without an invented environment', () => {
  // Captured from Three r174 on the same quad/lights, before display tone mapping.
  for (const [color, metalness, roughness, expected] of [
    [0xffffff, 0, 1, [227, 228, 229]],
    [0x808080, 0, 1, [115, 115, 116]],
    [0x808080, 1, 0.5, [52, 52, 52]],
    [0x993322, 0, 0.5, [137, 50, 37]],
  ] as const) {
    const material = G.standardSurface({ color, metalness, roughness });
    const { pages, geometry } = quadPages(material);
    const cam = camera();
    cam.position.z = 3;
    cam.updateMatrixWorld();
    const size: [number, number] = [64, 64],
      ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
    const pixels = shadeVisibility(ids, pages, cameraMoteur(cam), size),
      offset = (32 * 64 + 32) * 4;
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs(pixels[offset + c] - expected[c]) <= 2,
        `color ${color}, metal ${metalness}, channel ${c}: ${pixels[offset + c]} vs ${expected[c]}`,
      );
    geometry.dispose();
    material.dispose();
  }
});
