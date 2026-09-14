import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createTriangleDiagnosticMaterial,
  triangleGeometry,
  triangleSalt,
} from './triangleDiagnostic.ts';
import { exactPagesBackend, referenceBackend } from './index.ts';

function quad() {
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
  return { geometry, material, mesh, source };
}

const DAG = { errorModel: 'dag-group-qem-v1', clusterStrategy: 'dag-groups' as const };
/** Level-0 clusters nothing replaces: the smallest legal DAG the runtime reads. */
function dagRoots<T extends { id: number; min: number[]; max: number[] }>(pages: T[]) {
  const sphere = (page: T) => {
    const c = [0, 1, 2].map((i) => (page.min[i] + page.max[i]) / 2);
    return [...c, Math.hypot(...[0, 1, 2].map((i) => page.max[i] - c[i])) || 1];
  };
  return {
    pages: pages.map((page) => ({
      ...page,
      role: 'exact' as const,
      start: page.id * 3,
      level: 0,
      lodError: 0,
      sphere: sphere(page),
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    })),
    structure: { version: 1, roots: pages.map((_, index) => index), groups: [] },
  };
}

test('triangle diagnostic expands indexed geometry and assigns a color per submitted triangle', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const expanded = triangleGeometry(geometry);
  assert.equal(expanded.getIndex(), null);
  assert.equal(expanded.getAttribute('position').count, 6);
  assert.ok(expanded.getAttribute('color'));
  const colors = expanded.getAttribute('color').array;
  assert.notDeepEqual([...colors.subarray(0, 3)], [...colors.subarray(9, 12)]);
  assert.equal(triangleGeometry(geometry), expanded);
  geometry.dispose();
});

test('triangle material is a filled unlit with vertex colors, not GL_LINES wireframe', () => {
  const material = createTriangleDiagnosticMaterial(THREE.FrontSide, triangleSalt('0/0/1'));
  assert.equal(material.wireframe, false);
  assert.equal(material.vertexColors, true);
  material.dispose();
});

test('exact pages wireframe uses non-indexed submitted triangles', () => {
  const { geometry, material, mesh, source } = quad();
  const pages = [0, 1].map((id) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0],
    max: [1, 1, 0],
    bytes: 12,
    sha256: 'x',
  }));
  const backend = exactPagesBackend({
    source,
    metadata: {
      ...DAG,
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...dagRoots(pages) }],
    },
    indices: new Map([
      ['0', new Uint32Array([0, 1, 2])],
      ['1', new Uint32Array([0, 2, 3])],
    ]),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    maxResidentPages: 2,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  backend.render(camera);
  backend.setDiagnostic('wireframe');
  backend.render(camera);
  const drawn: THREE.Mesh[] = [];
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) drawn.push(o as THREE.Mesh);
  });
  assert.ok(drawn.length >= 1);
  assert.ok(drawn.every((item) => item.geometry.getIndex() === null));
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
  const { geometry, material, source } = quad();
  const backend = referenceBackend({
    source,
    metadata: {
      primitives: [],
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
  assert.equal((drawn[0].material as THREE.Material).wireframe, false);
  backend.render(new THREE.PerspectiveCamera());
  assert.equal(backend.metrics().submittedTriangles, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
