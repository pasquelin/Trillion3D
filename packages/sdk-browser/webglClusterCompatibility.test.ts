import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';

const position = new THREE.BufferAttribute(new Float32Array(9), 3);

test('an untextured Basic material needs no unused UV or normal attribute', () => {
  assert.equal(clusterMaterialReason(new THREE.MeshBasicMaterial(), { position }), undefined);
});

test('unsupported mutations refuse the autonomous draw before it becomes partial', () => {
  const material = new THREE.MeshStandardMaterial();
  assert.equal(
    clusterMaterialReason(material, { position }),
    'lit material has no normal attribute',
  );
  material.transparent = true;
  assert.match(clusterMaterialReason(material, { position })!, /clustered blend contract/);
  material.transparent = false;
  material.wireframe = true;
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
  material.wireframe = false;
  material.alphaMap = new THREE.Texture({});
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
});

test('a texture selecting UV1 is refused when geometry has only UV0', () => {
  const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture({}) });
  material.map!.channel = 1;
  assert.match(
    clusterMaterialReason(material, {
      position,
      uv: new THREE.BufferAttribute(new Float32Array(6), 2),
    })!,
    /no UV1 attribute/,
  );
});
