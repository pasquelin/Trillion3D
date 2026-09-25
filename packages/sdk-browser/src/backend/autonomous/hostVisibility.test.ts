import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createPlacementRows } from '../../placement/rows.ts';
import { triangleBackend } from './triangle.fixture.ts';

// A node of a compiled model hidden then shown by the host (#407): the WebGL2 cut skips its root
// while it or an ancestor is hidden, and draws it again once shown.
test('the WebGL2 path hides a compiled node the host hid, and draws it again once shown', async () => {
  const { backend, camera, geometry, material, mesh, source } = triangleBackend();
  const drawn = () => (backend.render(camera), backend.metrics().submittedTriangles);
  try {
    await backend.prepare();
    assert.equal(drawn(), 1);
    source.visible = false;
    assert.equal(drawn(), 0, 'an ancestor hidden hides it');
    assert.equal(drawn(), 0, 'and it stays hidden');
    source.visible = true;
    assert.equal(drawn(), 1, 'shown again, it is drawn again');
    mesh.visible = false;
    assert.equal(drawn(), 0, 'the node itself hidden');
    mesh.visible = true;
    assert.equal(drawn(), 1);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a node shown again leaves a parked row parked', async () => {
  const rows = createPlacementRows(1);
  rows.matrices.set(new G.Matrix4().toArray());
  rows.live[0] = 1;
  const { backend, camera, geometry, material, source } = triangleBackend({ placements: rows });
  const drawn = () => (backend.render(camera), backend.metrics().submittedTriangles);
  try {
    await backend.prepare();
    assert.equal(drawn(), 1);
    source.visible = false;
    assert.equal(drawn(), 0);
    rows.live[0] = 1;
    backend.updatePlacements!(rows, 0, 0);
    assert.equal(drawn(), 0, 'a row taken back under a hidden node stays hidden');
    rows.live[0] = 0;
    backend.updatePlacements!(rows, 0, 0);
    source.visible = true;
    assert.equal(drawn(), 0, 'shown again, its row is still parked');
    rows.live[0] = 1;
    backend.updatePlacements!(rows, 0, 0);
    assert.equal(drawn(), 1);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a node hidden before the first frame is not drawn by it', async () => {
  const { backend, camera, geometry, material, source } = triangleBackend();
  try {
    source.visible = false;
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 0);
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

// A video's frame on the WebGL2 path (#362): the next draw uploads it in place; a refresh of a
// picture alone lets the held image go and walks no scene, where a value written walks it.
test('a picture-only refresh releases the held image and walks no scene', async () => {
  const { backend, camera, geometry, material, mesh, source } = triangleBackend();
  let reads = 0;
  for (const node of [source, mesh]) {
    let visible = node.visible;
    Object.defineProperty(node, 'visible', {
      get: () => (reads++, visible),
      set: (next: boolean) => (visible = next),
    });
  }
  const frame = () => ((reads = 0), backend.render(camera), { held: backend.frameHeld, reads });
  try {
    await backend.prepare();
    frame();
    frame();
    const held = frame();
    assert.equal(held.held, true, 'a still scene is held');
    backend.refreshMaterials!(false);
    assert.deepEqual(frame(), { held: false, reads: held.reads }, 'a picture: no walk');
    backend.refreshMaterials!(true);
    assert.ok(frame().reads > held.reads, 'a value walks the scene again');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('the blended copy of a hidden node is not drawn, and is drawn again once shown', async () => {
  const glass = G.physicalSurface({ transmission: 1, thickness: 0.02, roughness: 0 });
  const { backend, camera, geometry, material, mesh, source } = triangleBackend({}, glass);
  const scene = backend.scene as G.GraphScene;
  const copy = scene.children.find((node) => node.userData.sourceMesh === mesh)!;
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(copy.visible, true);
    source.visible = false;
    backend.render(camera);
    assert.equal(copy.visible, false, 'an ancestor hidden hides its copy');
    source.visible = true;
    backend.render(camera);
    assert.equal(copy.visible, true, 'shown again, its copy is drawn again');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
