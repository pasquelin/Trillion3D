import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {OPEN_CONE,triangleCone,mergeCones,perspectiveSpread,coneCullsPage} from './pageCone.ts';
import {coneRejects} from '../sdk-core/index.ts';

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

test('perspectiveSpread is π when the camera is inside the bound sphere', () => {
  assert.equal(perspectiveSpread([0,0,0], 2, [0,0,0]), Math.PI);
});

test('mergeCones of identical cones is the same cone', () => {
  const a = {axis:[0,0,1] as [number,number,number], angle:0.1};
  const m = mergeCones(a, a);
  assert.ok(Math.abs(m.angle - 0.1) < 1e-6);
});
