import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend } from './index.ts';
import { drawnIndices, dagLevel, DAG } from './pagesBackendFixture.ts';
import { quadCluster, fanScene, frontCamera, quadRootsContext } from './pagesBackendScenes.ts';

test('transparent page batches preserve source order across exact and coarse cuts', () => {
  const { geometry, material, mesh, source, indices } = fanScene();
  // Clusters 0 and 1 are replaced together by the pair 3+4; cluster 2 is never replaced.
  const cluster = quadCluster;
  const level = dagLevel([cluster(0, 0), cluster(1, 3)], [cluster(3, 0), cluster(4, 1)], 0.001, [
    cluster(2, 6),
  ]);
  const context = {
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'clustered-blend', ...level }],
    },
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    pixelError: 0,
    viewport: [960, 540] as [number, number],
  };
  const backend = exactPagesBackend(context);
  const meshes = () =>
    backend.scene.children.filter((object) => (object as THREE.Mesh).isMesh) as THREE.Mesh[];
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(meshes().length, 1);
  // Transparent double face : les deux passes que Three.js improviserait à chaque image sont figées en
  // deux matériaux dos/face issus du matériau source, et deux groupes de géométrie les ordonnent.
  const split = meshes()[0].material as THREE.Material[];
  assert.ok(Array.isArray(split));
  assert.deepEqual([split[0].side, split[1].side], [THREE.BackSide, THREE.FrontSide]);
  assert.deepEqual(
    split.map((one) => (one as THREE.MeshBasicMaterial).color.getHex()),
    [material.color.getHex(), material.color.getHex()],
  );
  assert.deepEqual(
    meshes()[0].geometry.groups.map((group) => group.materialIndex),
    [0, 1],
  );
  assert.deepEqual(drawnIndices(meshes()[0]), [0, 1, 2, 0, 2, 3, 0, 3, 4]);
  context.pixelError = 10;
  backend.render(camera);
  assert.equal(meshes().length, 1);
  assert.deepEqual(drawnIndices(meshes()[0]), [0, 1, 3, 1, 2, 3, 0, 3, 4]);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages report measured residency and keep only the visible set in the scene', () => {
  const { geometry, material, context } = quadRootsContext(true, { maxResidentPages: 2 });
  const backend = exactPagesBackend(context);
  const meshes = () => {
    const found: THREE.Mesh[] = [];
    backend.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
    });
    return found;
  };
  assert.equal(meshes().length, 0);
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.equal(backend.metrics().geometryAllocationBytes, 12 * 4 + 2 * 3 * 4);
  assert.equal(meshes().length, 1);
  assert.equal(backend.metrics().drawCalls, 1);
  backend.setDiagnostic?.('pages');
  assert.equal(meshes().length, 2);
  backend.setDiagnostic?.('beauty');
  assert.equal(meshes().length, 1);
  camera.lookAt(0, 0, 10);
  backend.render(camera);
  assert.equal(backend.metrics().clusters, 0);
  assert.equal(backend.metrics().selectedTriangles, 0);
  assert.equal(backend.metrics().residentPages, 0);
  assert.equal(meshes().length, 0);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('cpuSelectMs mesure le temps de sélection, fini et non-négatif', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const cluster = (id: number, start: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
    start,
  });
  const context = {
    source,
    metadata: { ...DAG, primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots([cluster(0, 0)]) }] },
    indices: new Map([['0', new Uint32Array([0, 1, 2, 0, 2, 3])]]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 1,
  };
  const backend = exactPagesBackend(context);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  const metrics1 = backend.metrics();
  if (metrics1.cpuSelectMs !== null) {
    assert.ok(Number.isFinite(metrics1.cpuSelectMs), 'cpuSelectMs is finite when measured');
    assert.ok(metrics1.cpuSelectMs >= 0, 'cpuSelectMs is non-negative');
  }
  backend.render(camera);
  const metrics2 = backend.metrics();
  if (metrics2.cpuSelectMs !== null) {
    assert.ok(Number.isFinite(metrics2.cpuSelectMs), 'cpuSelectMs stays finite across renders');
    assert.ok(metrics2.cpuSelectMs >= 0, 'cpuSelectMs stays non-negative');
  }
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
