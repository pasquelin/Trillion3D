import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('a host diagnostic exception cannot break GPU initialization or rendering', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic() {
      throw new Error('HOST_LOG_FAILURE');
    },
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    assert.equal(backend.metrics().submittedTriangles, 2);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('transparent frustum selection preserves intersections, transformed bounds and the opt-out', async () => {
  installGpuGlobals();
  const cases = [
    { name: 'in view', position: [0, 0, 0], visible: true },
    { name: 'right', position: [100, 0, 0], visible: false },
    { name: 'left', position: [-100, 0, 0], visible: false },
    { name: 'above', position: [0, 100, 0], visible: false },
    { name: 'below', position: [0, -100, 0], visible: false },
    { name: 'behind', position: [0, 0, 10], visible: false },
    { name: 'past far plane', position: [0, 0, -110], visible: false },
    { name: 'partly in view', position: [3, 0, 0], visible: true },
    { name: 'near plane intersection', position: [0, 0, 4.9], rotate: true, visible: true },
    { name: 'mirrored nonuniform scale', position: [4, 0, 0], scale: [-4, 2, 1], visible: true },
    { name: 'disabled culling', position: [100, 0, 0], unculled: true, visible: true },
  ];
  for (const item of cases) {
    const fixture = quadScene(),
      { device, draws } = mockGpu(),
      mesh = fixture.source.children[0] as THREE.Mesh;
    fixture.metadata.primitives[0].pass = 'shared-blend';
    fixture.material.transparent = true;
    fixture.material.side = THREE.DoubleSide;
    mesh.position.fromArray(item.position);
    if (item.scale) mesh.scale.fromArray(item.scale);
    if (item.rotate) mesh.rotation.y = 0.5;
    mesh.frustumCulled = !item.unculled;
    fixture.source.updateMatrixWorld(true);
    const backend = webgpuPagesBackend({
      ...fixture,
      gpuDevice: device,
      maxResidentPages: 2,
      viewport: [32, 32],
    });
    try {
      await backend.prepare();
      backend.render(camera());
      const metrics = backend.metrics();
      // La scène porte son item et la coupe écrit le nombre d'instances de chaque appel ; un item
      // entièrement hors champ n'est pas encodé du tout, un item partiellement visible garde ses
      // deux faces. Le compte de rejets, lui, est relu à part.
      assert.equal(metrics.submittedTriangles, 4, item.name);
      assert.equal(metrics.transparentMeshes, 1, item.name);
      assert.equal(metrics.transparentFrustumRejected, item.visible ? 0 : 1, item.name);
      assert.equal(metrics.transparentDrawCalls, item.visible ? 2 : 0, item.name);
      assert.equal(metrics.transparentSubmittedTriangles, 4, item.name);
      const actual = draws.filter((draw) => draw.entryPoint === 'vs');
      assert.equal(actual.length, item.visible ? 2 : 0, item.name + ' actual GPU commands');
      assert.equal(
        actual.reduce((sum, draw) => sum + ((draw.instanceCount ?? 0) * draw.vertexCount) / 3, 0),
        item.visible ? 4 : 0,
        item.name + ' triangles réellement dessinés',
      );
    } finally {
      backend.dispose();
      fixture.geometry.dispose();
      fixture.material.dispose();
    }
  }
});

test('transparent selection follows each camera without retaining an old rejected list', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, draws } = mockGpu();
  fixture.metadata.primitives[0].pass = 'shared-blend';
  fixture.material.transparent = true;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  // Les triangles que la dernière image a réellement dessinés : le plan est le même d'une image à
  // l'autre, seul le nombre d'instances que la coupe écrit change.
  const dessines = () => {
    const image = draws.splice(0, draws.length).filter((draw) => draw.entryPoint === 'vs');
    return image.reduce((sum, draw) => sum + ((draw.instanceCount ?? 0) * draw.vertexCount) / 3, 0);
  };
  try {
    await backend.prepare();
    const cam = camera();
    draws.length = 0;
    backend.render(cam);
    assert.equal(backend.metrics().submittedTriangles, 2);
    assert.equal(dessines(), 2);
    cam.lookAt(100, 0, 5);
    cam.updateMatrixWorld();
    backend.render(cam);
    assert.equal(backend.metrics().transparentFrustumRejected, 1, 'le tronc rejette');
    assert.equal(dessines(), 0, 'la caméra détournée ne dessine plus rien');
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    backend.render(cam);
    assert.equal(backend.metrics().transparentFrustumRejected, 0, 'aucune liste de rejet gardée');
    assert.equal(dessines(), 2, 'l’item revient sans rien avoir perdu');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
