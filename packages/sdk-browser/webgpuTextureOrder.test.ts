import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { camera } from './webgpuPagesTestScenes.ts';

/**
 * Deux pages, deux matériaux, deux textures couleur. La page lourde — cent triangles devant la
 * caméra — est rangée **en second** dans l'atlas ; la page d'un seul triangle, loin derrière, est
 * rangée en premier. L'ordre de l'atlas et l'ordre de la caméra sont donc opposés, et les écritures
 * de texture disent lequel des deux la pompe a suivi.
 */
function twoPageScene() {
  const corners = (z: number) => [-1, -1, z, 1, -1, z, 1, 1, z];
  const light = new THREE.BufferGeometry(),
    heavy = new THREE.BufferGeometry();
  light.setAttribute('position', new THREE.Float32BufferAttribute(corners(60), 3));
  light.setIndex([0, 1, 2]);
  heavy.setAttribute('position', new THREE.Float32BufferAttribute(corners(0), 3));
  heavy.setIndex(Array.from({ length: 300 }, (_, i) => i % 3));
  const texture = (value: number) => new THREE.DataTexture(new Uint8Array(16).fill(value), 2, 2);
  const lightMaterial = new THREE.MeshStandardMaterial({ map: texture(10) }),
    heavyMaterial = new THREE.MeshStandardMaterial({ map: texture(200) });
  const lightMesh = new THREE.Mesh(light, lightMaterial),
    heavyMesh = new THREE.Mesh(heavy, heavyMaterial);
  const source = new THREE.Group();
  source.add(lightMesh, heavyMesh);
  const page = (url: string, count: number, z: number) => ({
    id: 0,
    url,
    count,
    min: [-1, -1, z],
    max: [1, 1, z],
    bytes: count * 4,
    sha256: 'x',
  });
  const structure = { version: 1, roots: [0], groups: [] };
  const primitive = (mesh: number, url: string, count: number, z: number) => ({
    mesh,
    primitive: 0,
    pass: 'exact-clusters',
    pages: dagRoots([page(url, count, z)]),
    structure,
  });
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [primitive(0, '0', 3, 60), primitive(1, '1', 300, 0)],
  };
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', Uint32Array.from({ length: 300 }, (_, i) => i % 3)],
  ]);
  const associations = new Map([
    [lightMesh, { meshes: 0, primitives: 0 }],
    [heavyMesh, { meshes: 1, primitives: 0 }],
  ]);
  const dispose = () => {
    light.dispose();
    heavy.dispose();
    lightMaterial.map?.dispose();
    heavyMaterial.map?.dispose();
    lightMaterial.dispose();
    heavyMaterial.dispose();
  };
  return { source, metadata, indices, associations, dispose };
}

/**
 * Le défaut que ce test tient : en boucle d'images, sans `flush()`, le signal de priorité doit
 * exister. La coupe dessinée n'est refaite qu'à l'adoption d'un relevé de sélection, qui n'arrive
 * qu'à `flush()` ; en boucle d'images elle reste vide, tous les poids valent zéro, la file n'est
 * plus réordonnée et les textures partent dans l'ordre de l'atlas au lieu de celui de la caméra.
 */
test('en boucle d’images sans flush, la texture de la surface la plus lourde part la première', async () => {
  installGpuGlobals();
  const fixture = twoPageScene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const { device, textureWrites } = mockGpu(undefined, packDagSelection(collected.roots));
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
    // Une texture par passe : l'ordre de la file se lit directement dans les écritures.
    maxTextureTransferBytesPerFrame: 16,
  } as never);
  try {
    await backend.prepare();
    // Boucle d'images ordinaire : aucun `flush()`, aucune barrière, la pompe avance sous le budget.
    for (let frame = 0; frame < 4; frame++) {
      backend.render(camera());
      await Promise.resolve();
    }
    assert.equal(backend.metrics().texturePending, 0, 'la file se vide en boucle d’images');
    assert.equal(backend.metrics().textureSkipped, 0);
    assert.deepEqual(
      textureWrites.filter((write) => write.mipLevel === 0).map((write) => write.layer),
      [2, 1],
      'la couche de la page de cent triangles passe avant celle de la page d’un triangle',
    );
  } finally {
    backend.dispose();
    fixture.dispose();
  }
});
