import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('mixed GPU and transparent pages wait for initial coverage before validating the resident cut', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    blend = quadScene();
  const mesh = blend.source.children[0] as THREE.Mesh;
  fixture.source.add(mesh);
  blend.material.transparent = true;
  blend.material.side = THREE.DoubleSide;
  const primitive = blend.metadata.primitives[0];
  primitive.mesh = 1;
  primitive.pass = 'clustered-blend';
  primitive.pages = primitive.pages.map((page) => ({ ...page, url: `blend-${page.url}` }));
  fixture.metadata.primitives.push(primitive);
  fixture.associations.set(mesh, { meshes: 1, primitives: 0 });
  for (const [url, array] of blend.indices) fixture.indices.set(`blend-${url}`, array);
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const { device } = mockGpu(
    undefined,
    packDagSelection(collected.roots.filter((root) => !root.pages[0].transparent)),
  );
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    assert.equal(backend.capabilities.gpuDriven, true);
    assert.doesNotThrow(() => backend.render(camera()));
    assert.equal(backend.metrics().coverageReady, false);
    assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1', 'blend-0', 'blend-1']);
    for (const [url, array] of fixture.indices) backend.acceptPage!(url, array);
    await backend.flush();
    backend.render(camera());
    await backend.flush();
    assert.equal(backend.metrics().coverageReady, true);
    assert.equal(backend.metrics().transparentSubmittedTriangles, 4);
    assert.equal(backend.metrics().submittedTriangles, 6);
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
    blend.geometry.dispose();
    blend.material.dispose();
  }
});

test('cached clustered cuts keep visibility current and leave unchanged mesh indices uploaded', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    other = quadScene(),
    legacy = quadScene(),
    { device, writes } = mockGpu();
  fixture.material.transparent = true;
  fixture.material.side = THREE.DoubleSide;
  fixture.metadata.primitives[0].pass = 'clustered-blend';
  const mesh = fixture.source.children[0] as THREE.Mesh,
    legacyMesh = legacy.source.children[0] as THREE.Mesh;
  legacy.material.transparent = true;
  legacy.material.side = THREE.DoubleSide;
  legacy.metadata.primitives[0].mesh = 1;
  legacy.metadata.primitives[0].pass = 'shared-blend';
  fixture.source.add(legacyMesh);
  fixture.metadata.primitives.push(legacy.metadata.primitives[0]);
  fixture.associations.set(legacyMesh, { meshes: 1, primitives: 0 });
  const otherMesh = other.source.children[0] as THREE.Mesh;
  other.material.transparent = true;
  other.material.side = THREE.DoubleSide;
  const otherPrimitive = other.metadata.primitives[0];
  otherPrimitive.mesh = 2;
  otherPrimitive.pass = 'clustered-blend';
  otherPrimitive.pages = otherPrimitive.pages.map((page) => ({
    ...page,
    url: `other-${page.url}`,
  }));
  fixture.source.add(otherMesh);
  fixture.metadata.primitives.push(otherPrimitive);
  fixture.associations.set(otherMesh, { meshes: 2, primitives: 0 });
  for (const [url, array] of other.indices) fixture.indices.set(`other-${url}`, array);
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 6,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    assert.equal(backend.metrics().transparentSubmittedTriangles, 12);
    const uploads = writes.length;
    otherMesh.position.x = 100;
    backend.render(cam);
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      8,
      'another paged mesh can disappear without changing this mesh cut',
    );
    legacyMesh.position.x = 100;
    backend.render(cam);
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      4,
      'legacy bounds update while the paged cut stays unchanged',
    );
    mesh.position.x = 100;
    backend.render(cam);
    assert.equal(backend.metrics().transparentSubmittedTriangles, 0);
    mesh.position.x = 0;
    backend.render(cam);
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      4,
      'cached pages become visible again',
    );
    legacyMesh.position.x = 0;
    backend.render(cam);
    assert.equal(backend.metrics().transparentSubmittedTriangles, 8);
    otherMesh.position.x = 0;
    backend.render(cam);
    assert.equal(backend.metrics().transparentSubmittedTriangles, 12);
    assert.equal(
      writes.slice(uploads).filter((write) => write.bytes.byteLength === 24).length,
      0,
      'existing index buffers survive visibility changes',
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
    other.geometry.dispose();
    other.material.dispose();
    legacy.geometry.dispose();
    legacy.material.dispose();
  }
});
