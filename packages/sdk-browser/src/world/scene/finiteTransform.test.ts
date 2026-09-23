// Case 4 of the singular-normals convention (singular-normals batch): a non-finite host
// pose never enters the engine. `loadPreparedScene` refuses it at load, before it would
// come out as a null normal or a darkened surface far from its cause. Refusal on move
// (`setWebgpuTransform`) is in `../../webgpu/core/transformFiniteTransform.test.ts`. Split out to keep
// `scene.test.ts` under 200 lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './scene.ts';
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;

test('loadPreparedScene refuses a non-finite world matrix (NON_FINITE_TRANSFORM)', async (t) => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = 'cible';
  mesh.position.set(NaN, 0, 0);
  scene.add(mesh);
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => ({
    scene,
    parser: { associations: new Map() },
  }));
  await assert.rejects(
    () =>
      loadPreparedScene(
        { manifestUrl: '' },
        manifest,
        'scene.gltf',
        'http://localhost/',
        'full',
        false,
        undefined,
        () => {},
        () => {},
      ),
    (erreur: unknown) =>
      erreur instanceof EngineError &&
      erreur.code === 'NON_FINITE_TRANSFORM' &&
      erreur.details.nodeName === 'cible',
    'a NaN world matrix must throw NON_FINITE_TRANSFORM, node name included',
  );
});
