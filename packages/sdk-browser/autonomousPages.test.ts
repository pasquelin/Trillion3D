import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import { decodeGeometryPage } from './geometryPage.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

test('autonomous pages add, move and remove an instance while keeping page coverage', async () => {
  const position = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]);
  const encoded = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    mesh = new THREE.Mesh(geometry, material),
    source = new THREE.Group();
  source.add(mesh);
  const descriptor = {
    url: 'triangle-geometry.bin',
    sha256: 'x',
    bytes: encoded.data.length,
    vertexCount: encoded.vertexCount,
    indexCount: encoded.indexCount,
    flags: encoded.flags,
    uncompressedBytes: encoded.uncompressedBytes,
  };
  const page = {
    id: 0,
    url: 'triangle.bin',
    sha256: 'x',
    bytes: 12,
    count: 3,
    min: [-0.5, -0.5, 0],
    max: [0.5, 0.5, 0],
    role: 'exact' as const,
    start: 0,
    level: 0,
    lodError: 0,
    sphere: [0, 0, 0, 1],
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    geometry: descriptor,
  };
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups',
        pages: [page],
        structure: { version: 1, roots: [0], groups: [] },
      },
    ],
  } as unknown as ClusterManifest;
  const backend = autonomousPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    readGeometryPage: async () => encoded.data,
    maxResidentPages: 2,
  });
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1);
    backend.addInstance?.('copy', new THREE.Matrix4().makeTranslation(1, 0, 0));
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 2);
    backend.updateInstance?.('copy', new THREE.Matrix4().makeTranslation(2, 0, 0));
    backend.render(camera);
    const copies = backend.scene.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[];
    assert.ok(copies.some((copy) => copy.matrix.elements[12] === 2));
    const replacement = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    backend.updateMaterial?.('0/0', replacement);
    assert.ok(copies.every((copy) => copy.material === replacement));
    const replacementPage = decodeGeometryPage(encoded.data);
    replacementPage.attributes.position[0] = -0.25;
    backend.replaceGeometryPage?.('triangle-geometry.bin', replacementPage);
    backend.acceptGeometryPage?.('triangle-geometry.bin', decodeGeometryPage(encoded.data));
    backend.dropPage?.('triangle-geometry.bin');
    backend.render(camera);
    const updated = backend.scene.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
    assert.equal(updated.geometry.getAttribute('position').getX(0), -0.25);
    assert.equal(backend.metrics().submittedTriangles, 2);
    backend.removeInstance?.('copy');
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1);
    replacement.dispose();
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
