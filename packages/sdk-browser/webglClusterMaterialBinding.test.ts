// The WebGL2 cluster binder's map uniforms, without a GL context: its four collaborators are
// injected, so what it sends them is readable directly. What is proved here is the UV transform it
// uploads — the engine record's own nine elements, under the unit's uniform name, for a bound map
// and for that map alone — since the binder no longer recomposes a host matrix per bind.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindClusterMaterial } from './webglClusterMaterialBinding.ts';
import { importHostTexture } from './hostSurfaceImport.ts';

type Binding = Parameters<typeof bindClusterMaterial>[0];

/** Records every matrix the binder uploads; the other three collaborators only have to answer. */
function recorder() {
  const uploaded: { name: string; value: ArrayLike<number> }[] = [];
  const nothing = () => {};
  const binding = {
    uniforms: {
      f1: nothing,
      f2: nothing,
      f3: nothing,
      f4: nothing,
      i1: nothing,
      i2: nothing,
      i4: nothing,
    },
    matrices: {
      set: (name: string, value: ArrayLike<number>) => void uploaded.push({ name, value }),
    },
    textures: { bind: nothing },
    state: { apply: nothing },
  } as unknown as Binding;
  return { binding, uploaded };
}

const texture = () => {
  const map = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  map.needsUpdate = true;
  return map;
};

test('A bound map uploads the imported record transform, under its own uniform', () => {
  const map = texture();
  const material = new THREE.MeshStandardMaterial({ map });
  const { binding, uploaded } = recorder();
  bindClusterMaterial(binding, material, true);
  assert.equal(uploaded.length, 1, 'the five maps the material does not declare upload nothing');
  assert.equal(uploaded[0].name, 'baseUv');
  assert.equal(uploaded[0].value, importHostTexture(map).transform, 'the record own elements');
  assert.deepEqual([...uploaded[0].value], [...map.matrix.elements]);
});

test('A host recomposition of the UV transform reaches the next bind', () => {
  const map = texture();
  const material = new THREE.MeshStandardMaterial({ normalMap: map });
  map.offset.set(0.25, 0.5);
  map.updateMatrix();
  const { binding, uploaded } = recorder();
  bindClusterMaterial(binding, material, true);
  assert.equal(uploaded[0].name, 'normalUv');
  assert.deepEqual([...uploaded[0].value], [...map.matrix.elements]);
  assert.equal(uploaded[0].value[6], 0.25, 'the offset the host composed is what the shader reads');
});
