import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { DIRECT_LIGHTING_SHADER } from './deferredLighting.ts';
import {
  rasterVisibilityIds,
  shadeVisibility,
  visMaterial,
  isTransmissive,
  VIS_INVALID,
} from './visibilityBuffer.ts';
import { camera, quadPages } from './visibilityBufferFixture.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('Repeat wrap samples the same texel at UV 0.25 and 1.25', () => {
  const map = new THREE.DataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    2,
    2,
    THREE.RGBAFormat,
  );
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.flipY = false;
  map.needsUpdate = true;
  const a = new THREE.MeshBasicMaterial({ color: 0xffffff, map });
  const b = new THREE.MeshBasicMaterial({ color: 0xffffff, map });
  const left = quadPages(a, [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
  const right = quadPages(b, [1.25, 0.25, 1.25, 0.25, 1.25, 0.25, 1.25, 0.25]);
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(left.pages, cameraMoteur(cam), size);
  const image = compareImages(
    shadeVisibility(ids, left.pages, cameraMoteur(cam), size),
    shadeVisibility(
      rasterVisibilityIds(right.pages, cameraMoteur(cam), size),
      right.pages,
      cameraMoteur(cam),
      size,
    ),
  );
  assert.equal(image.maxChannelError, 0);
  left.geometry.dispose();
  right.geometry.dispose();
  a.dispose();
  b.dispose();
  map.dispose();
});

test('FrontSide visbuffer culls a back-facing triangle', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.FrontSide });
  const { pages, geometry } = quadPages(material);
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam.position.z = -5;
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), [16, 16]);
  assert.ok([...ids].every((id) => id === VIS_INVALID));
  geometry.dispose();
  material.dispose();
});

test('a metalness map B=0 keeps a dielectric; B=1 is a metal', () => {
  const dielectric = new THREE.DataTexture(
    new Uint8Array([0, 255, 0, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  const metal = new THREE.DataTexture(new Uint8Array([0, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  const a = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    metalnessMap: dielectric,
  });
  const b = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    metalnessMap: metal,
  });
  const { pages, geometry } = quadPages(a, [0, 0, 1, 0, 1, 1, 0, 1]);
  const metalPages = pages.map((page) => ({ ...page, material: b }));
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  const dark = shadeVisibility(ids, pages, cameraMoteur(cam), size),
    bright = shadeVisibility(ids, metalPages, cameraMoteur(cam), size);
  assert.ok(compareImages(dark, bright).maxChannelError > 0);
  assert.equal(visMaterial(a).metalness, 1);
  assert.ok(visMaterial(a).metalnessMap);
  geometry.dispose();
  a.dispose();
  b.dispose();
  dielectric.dispose();
  metal.dispose();
});

test('a roughness map G channel changes the GGX highlight', () => {
  const smooth = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  const rough = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, THREE.RGBAFormat);
  const a = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    roughnessMap: smooth,
  });
  const b = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    roughnessMap: rough,
  });
  const { pages, geometry } = quadPages(a, [0, 0, 1, 0, 1, 1, 0, 1]);
  const roughPages = pages.map((page) => ({ ...page, material: b }));
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  assert.ok(
    compareImages(
      shadeVisibility(ids, pages, cameraMoteur(cam), size),
      shadeVisibility(ids, roughPages, cameraMoteur(cam), size),
    ).maxChannelError > 0,
  );
  geometry.dispose();
  a.dispose();
  b.dispose();
  smooth.dispose();
  rough.dispose();
});

test('transmissive MeshPhysicalMaterial is not packed for the visbuffer', () => {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x228866,
    transmission: 1,
    thickness: 0.02,
    roughness: 0,
    metalness: 0,
  });
  assert.equal(visMaterial(material).transmission, 1);
  assert.equal(isTransmissive(material), true);
  assert.equal(isTransmissive(new THREE.MeshStandardMaterial()), false);
  material.dispose();
});

test('MeshStandardMaterial visbuffer lighting implements Cook-Torrance GGX microfacet BRDF', () => {
  const basic = new THREE.MeshBasicMaterial({ color: 0x331111 });
  const standard = new THREE.MeshStandardMaterial({ color: 0x331111, metalness: 0, roughness: 1 });
  const { pages, geometry } = quadPages(basic);
  const litPages = pages.map((page) => ({ ...page, material: standard }));
  const cam = camera(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds(pages, cameraMoteur(cam), size);
  assert.deepEqual(ids, rasterVisibilityIds(litPages, cameraMoteur(cam), size));
  const unlit = shadeVisibility(ids, pages, cameraMoteur(cam), size);
  const lit = shadeVisibility(ids, litPages, cameraMoteur(cam), size);
  assert.ok(compareImages(unlit, lit).maxChannelError > 0);
  assert.match(DIRECT_LIGHTING_SHADER, /alpha2\s*\/\s*\(3\.14159265/);
  assert.match(DIRECT_LIGHTING_SHADER, /let Vis=0\.5\/\(gV\+gL\+1e-7\)/);

  geometry.dispose();
  basic.dispose();
  standard.dispose();
});
