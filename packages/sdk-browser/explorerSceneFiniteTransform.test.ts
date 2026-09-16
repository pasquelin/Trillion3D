// Cas 4 de la convention des normales singulières (lot normales singulières) : une pose hôte non
// finie n'entre jamais dans le moteur. `loadPreparedScene` la refuse au chargement, avant qu'elle ne
// ressorte en normale nulle ou en surface éteinte loin de sa cause. Le refus au déplacement
// (`setWebgpuTransform`) est dans `webgpuTransformFiniteTransform.test.ts`. À part pour tenir
// `explorerScene.test.ts` sous 200 lignes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './explorerScene.ts';
import { EngineError, type ClusterManifest } from '../sdk-core/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;

test('loadPreparedScene refuse une matrice monde non finie (NON_FINITE_TRANSFORM)', async (t) => {
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
        {},
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
    'une matrice monde NaN doit lever NON_FINITE_TRANSFORM, nom du nœud compris',
  );
});
