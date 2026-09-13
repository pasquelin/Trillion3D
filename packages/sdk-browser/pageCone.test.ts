import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {OPEN_CONE,triangleCone,coneCullsPage} from './pageCone.ts';

test('a single front-facing triangle has a narrow cone along +z', () => {
  const cone = triangleCone([0,0,0, 1,0,0, 0,1,0], [0,1,2]);
  assert.ok(cone.angle < 1e-6);
  assert.ok(cone.axis[2] > 0.9);
});

test('opposite triangles produce an open cone', () => {
  const cone = triangleCone(
    [0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, 1,0,0],
    [0,1,2, 3,4,5],
  );
  assert.ok(cone.angle >= Math.PI / 2 - 1e-6);
});

test('OPEN_CONE never rejects', () => {
  const world = new THREE.Matrix4();
  const cam = new THREE.PerspectiveCamera(55,1,.1,100);
  cam.position.set(0,0,5); cam.lookAt(0,0,0); cam.updateMatrixWorld();
  assert.equal(coneCullsPage(OPEN_CONE, world, [-1,-1,0], [1,1,0], cam), false);
});

test('a +z cone seen from behind the plane is rejected, and perspective spread keeps a grazing bound', () => {
  const cone = {axis:[0,0,1] as [number,number,number], angle: Math.PI/6};
  const world = new THREE.Matrix4();
  const behind = new THREE.PerspectiveCamera(55,1,.1,100);
  behind.position.set(0,0,-5); behind.lookAt(0,0,0); behind.updateMatrixWorld();
  assert.equal(coneCullsPage(cone, world, [-0.1,-0.1,0], [0.1,0.1,0], behind), true);
  const grazing = new THREE.PerspectiveCamera(55,1,.1,100);
  grazing.position.set(0,0,5); grazing.lookAt(0,0,0); grazing.updateMatrixWorld();
  assert.equal(coneCullsPage(cone, world, [-1,-1,0], [1,1,0], grazing), false);
});

test('an anisotropic scale does not reject a still-visible cone member', () => {
  const cone = {axis:[0,0,1] as [number,number,number], angle: Math.PI/4};
  const world = new THREE.Matrix4().makeScale(.1,1,1);
  const cam = new THREE.PerspectiveCamera(55,1,.1,200);
  cam.position.set(60,0,-80); cam.lookAt(0,0,0); cam.updateMatrixWorld();
  const visible = new THREE.Vector3(1,0,1).normalize().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(world));
  assert.ok(visible.dot(cam.position.clone().normalize()) > 0);
  assert.equal(coneCullsPage(cone, world, [-.01,-.01,-.01], [.01,.01,.01], cam), false);
});

test('BackSide materials are not cone-culled from behind', () => {
  const cone = {axis:[0,0,1] as [number,number,number], angle: Math.PI/6};
  const world = new THREE.Matrix4();
  const behind = new THREE.PerspectiveCamera(55,1,.1,100);
  behind.position.set(0,0,-5); behind.lookAt(0,0,0); behind.updateMatrixWorld();
  const material = new THREE.MeshBasicMaterial({side: THREE.BackSide});
  assert.equal(coneCullsPage(cone, world, [-0.1,-0.1,0], [0.1,0.1,0], behind, material), false);
  material.dispose();
});
