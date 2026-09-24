import test from 'node:test';
import { asHostLibrary } from '../host/resources.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { exactPagesBackend, referenceBackend } from '../../../../bench/witnesses/measurement.ts';
import { threeLodBackend } from '../../../../bench/witnesses/three/lod.ts';
import { dagRoots, DAG, MANIFEST_IDENTITY } from './pagesBackend.fixture.ts';
import {
  quadScene,
  quadPages,
  quadIndices,
  frontCamera,
  assertSingleCoarseCluster,
  coarseQuadContext,
  triangleGeometry,
} from './pagesBackendScenes.fixture.ts';
import { submittedDraws } from '../cluster/batchMesh.ts';

test('source instance transforms update all three WebGL backends without rebuilding pages', () => {
  for (const factory of [referenceBackend, exactPagesBackend, threeLodBackend]) {
    const geometry = triangleGeometry();
    const material = new THREE.MeshBasicMaterial(),
      mesh = new THREE.Mesh(geometry, material),
      source = new THREE.Group();
    source.add(mesh);
    const page = {
      id: 0,
      url: '0',
      count: 3,
      min: [-1, -1, 0],
      max: [1, 1, 0],
      bytes: 12,
      sha256: 'x',
    };
    const backend = factory({
      source,
      metadata: {
        ...DAG,
        ...MANIFEST_IDENTITY,
        primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots([page]) }],
      },
      indices: new Map([['0', new Uint32Array([0, 1, 2])]]),
      associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    });
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    backend.render(camera);
    mesh.position.x = 100;
    backend.render(camera);
    if (backend.id === 'exact-cluster-pages') assert.equal(backend.metrics().selectedTriangles, 0);
    else {
      const object = asHostLibrary<THREE.Object3D[]>(backend.scene.children).find(
        (child) => child.type === 'Mesh' || child.type === 'LOD',
      );
      assert.ok(object);
      assert.equal(object.matrix.elements[12], 100);
    }
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a cut over the resident budget raises the flag and still covers the surface once', () => {
  const { geometry, material, mesh, source } = quadScene();
  const pages = quadPages();
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      ...MANIFEST_IDENTITY,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: quadIndices(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 1,
  });
  const camera = frontCamera();
  backend.render(camera);
  // A DAG cut is a partition: truncating it would punch a hole, so the cover stays whole and only
  // the flag is raised. Both clusters are still drawn, in one batch.
  assert.equal(backend.overBudget, true);
  assert.equal(submittedDraws(backend).length, 1);
  assert.equal(backend.metrics().residentPages, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('exact pages select coarse LOD when the screen error is under the pixel threshold', () => {
  const { geometry, material, context } = coarseQuadContext(10);
  const backend = exactPagesBackend(context);
  assertSingleCoarseCluster(backend, { geometry, material });
});
