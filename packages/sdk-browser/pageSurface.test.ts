import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { refreshSurface, surfaceOf, surfaceSide } from './pageSurface.ts';

test('one record per declaration, shared by every page and placement that wears it', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0x336699, metalness: 0.25 });
  const first = surfaceOf(material);
  assert.equal(surfaceOf(material), first, 'the same declaration yields the same record');
  assert.equal(first.metalness, 0.25);
  assert.deepEqual(
    first.baseColor.map((c) => Number(c.toFixed(4))),
    [material.color.r, material.color.g, material.color.b].map((c) => Number(c.toFixed(4))),
  );
  assert.notEqual(
    surfaceOf(new THREE.MeshStandardMaterial()),
    first,
    'another declaration, another record',
  );
  material.dispose();
});

test('the raster facts are reread on a side the host writes in place, which bumps no version', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const surface = surfaceOf(material);
  assert.equal(surfaceSide(surface), 'front');
  material.side = THREE.DoubleSide;
  assert.equal(surfaceSide(refreshSurface(surface)), 'double', 'the plan sees the switch');
  material.side = THREE.BackSide;
  assert.equal(surfaceSide(refreshSurface(surface)), 'back');
  material.dispose();
});

test('the shaded fields are reread when the host bumps the version, and not before', () => {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const surface = surfaceOf(material);
  assert.equal(surface.roughness, 0.9);
  material.roughness = 0.1;
  assert.equal(refreshSurface(surface).roughness, 0.9, 'no version, no walk of the map slots');
  material.needsUpdate = true;
  assert.equal(refreshSurface(surface).roughness, 0.1, 'the version moved: the record follows');
  material.dispose();
});

test('a declaration of several materials is blended if any of them is, and reads as grouped', () => {
  const opaque = new THREE.MeshBasicMaterial();
  const blended = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 });
  const group = surfaceOf([opaque, blended]);
  assert.equal(group.transparent, true, 'one blended element makes the declaration blended');
  assert.equal(group.grouped, true);
  assert.equal(group.opacity, 1, 'the first element decides the raster values');
  const alone = surfaceOf([blended]);
  assert.equal(alone.grouped, false, 'one material in an array is not a group');
  assert.equal(alone.opacity, 0.4);
  const empty = surfaceOf([]);
  assert.equal(empty.transparent, false);
  assert.equal(surfaceSide(empty), 'front', 'an empty declaration declares the host default');
  opaque.dispose();
  blended.dispose();
});

test('a record this module did not build is returned untouched', () => {
  const foreign = { ...surfaceOf(new THREE.MeshBasicMaterial()), version: 7 };
  assert.equal(refreshSurface(foreign), foreign);
  assert.equal(foreign.version, 7);
});
