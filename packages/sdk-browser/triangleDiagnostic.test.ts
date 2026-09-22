import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyMeshDiagnostic, triangleGeometry } from './triangleDiagnostic.ts';
import { hostDiagnostics } from './threeSceneAdapter.ts';
import { asHostLibrary } from './hostResources.ts';
import { exactPagesBackend, referenceBackend } from './measurement.ts';
import { quadScene, frontCamera, quadRootsContext } from './pagesBackendScenes.ts';
import { submittedDraws } from './clusterBatchMesh.ts';

test('triangle diagnostic expands indexed geometry and assigns a color per submitted triangle', () => {
  const { geometry } = quadScene();
  const expanded = asHostLibrary<THREE.BufferGeometry>(triangleGeometry(geometry, hostDiagnostics));
  assert.equal(expanded.getIndex(), null);
  assert.equal(expanded.getAttribute('position').count, 6);
  assert.ok(expanded.getAttribute('color'));
  const colors = expanded.getAttribute('color').array;
  assert.notDeepEqual([...colors.subarray(0, 3)], [...colors.subarray(9, 12)]);
  assert.equal(triangleGeometry(geometry, hostDiagnostics), expanded);
  geometry.dispose();
});

test('triangle material is filled and unlit with vertex colors', () => {
  const material = asHostLibrary<THREE.MeshBasicMaterial>(
    hostDiagnostics.triangleMaterial(THREE.FrontSide),
  );
  assert.ok(material instanceof THREE.MeshBasicMaterial);
  assert.equal(material.wireframe, false);
  assert.equal(material.vertexColors, true);
  material.dispose();
});

test('a mesh diagnostic swaps in the triangle colouring and hands the source back on beauty', () => {
  const { geometry, material, mesh } = quadScene();
  mesh.userData.sourceGeometry = geometry;
  mesh.userData.sourceMaterial = material;
  material.side = THREE.DoubleSide;
  const overlays: THREE.Material[] = [];
  applyMeshDiagnostic(mesh, 'wireframe', overlays, hostDiagnostics);
  assert.equal(mesh.geometry, triangleGeometry(geometry, hostDiagnostics));
  assert.equal(overlays.length, 1);
  assert.equal(mesh.material, overlays[0]);
  assert.equal((mesh.material as THREE.Material).side, THREE.DoubleSide);
  applyMeshDiagnostic(mesh, 'beauty', overlays, hostDiagnostics);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  assert.equal(overlays.length, 1, 'the overlay stays for its owner to dispose');
  overlays[0].dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages wireframe uses non-indexed submitted triangles', () => {
  const { geometry, material, context } = quadRootsContext(true, { maxResidentPages: 2 });
  const backend = exactPagesBackend(context);
  const camera = frontCamera();
  backend.render(camera);
  backend.setDiagnostic?.('wireframe');
  backend.render(camera);
  const drawn = submittedDraws(backend);
  assert.ok(drawn.length >= 1);
  assert.ok(drawn.every((item) => item.geometry.index === null));
  assert.ok(
    drawn.every(
      (item) =>
        item.material instanceof THREE.MeshBasicMaterial &&
        item.material.vertexColors &&
        !item.material.wireframe,
    ),
  );
  assert.equal(backend.metrics().submittedTriangles, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('reference backend wireframe expands source triangles instead of MeshBasicMaterial.wireframe', () => {
  const { geometry, material, source } = quadScene();
  const backend = referenceBackend({
    source,
    metadata: {
      primitives: [],
      sourceTriangles: 2,
      selectedTriangles: 2,
      selectedNodes: [],
      totalNodes: 0,
      schema: 1,
      status: 'ready',
      key: 't',
      scope: 'full',
    },
    indices: new Map(),
    associations: new Map(),
  });
  backend.setDiagnostic?.('wireframe');
  const drawn: THREE.Mesh[] = [];
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) drawn.push(o as THREE.Mesh);
  });
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].geometry.getIndex(), null);
  assert.equal(drawn[0].geometry.getAttribute('position').count, 6);
  const drawnMaterial = drawn[0].material;
  assert.ok(drawnMaterial instanceof THREE.MeshBasicMaterial);
  assert.equal(drawnMaterial.wireframe, false);
  backend.render(new THREE.PerspectiveCamera());
  assert.equal(backend.metrics().submittedTriangles, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
