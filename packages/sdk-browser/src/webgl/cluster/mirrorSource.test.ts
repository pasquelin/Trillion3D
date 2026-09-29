import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../core/testContext.fixture.ts';
import { WebglClusterRenderer } from './renderer.ts';
import { readDegraded } from './validation.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import { clusterWebglCompatibility } from './compatibility.ts';

test('WebGL reflection captures stay allocated for rough receivers and leave with the last specular lobe', () => {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    );
  const material = new G.GraphSurface('standard', { roughness: 0, metalness: 1 });
  const geometry = new G.Geometry().setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new G.BufferAttribute(new Float32Array(9), 3));
  const mesh = new G.Mesh(geometry, material) as unknown as WholeMesh;
  const draw = () => renderer.draw([], { lights: [] }, createHostDrawCamera(), true, true, [mesh]);
  draw();
  assert.equal(renderer.backdropPasses, 1);
  assert.equal(renderer.backdropSubmissions, 1);
  // Capture, the reduced resolve and the main pass: the receiver is drawn once more.
  assert.equal(renderer.resolvePasses, 1);
  assert.equal(renderer.triangles, 3);
  const sourceBytes = 8 * 4 * 12 + (4 * 2 + 2 * 1 + 1) * (8 + 8);
  const resolveBytes = 8 * 4 * 12;
  assert.equal(
    renderer.backdropBytes,
    sourceBytes + resolveBytes,
    'source mips and the reduced resolve',
  );
  material.roughness = 1;
  material.needsUpdate = true;
  draw();
  assert.equal(renderer.backdropPasses, 1, 'rough physical receivers still reflect');
  assert.equal(renderer.resolvePasses, 1);
  assert.equal(renderer.backdropBytes, sourceBytes + resolveBytes);
  assert.equal(renderer.triangles, 3);
  mesh.material = new G.GraphSurface('lambert');
  draw();
  assert.equal(renderer.backdropPasses, 0);
  assert.equal(renderer.resolvePasses, 0);
  assert.equal(renderer.backdropBytes, 0);
  renderer.dispose();
});

test('a mirror missing half-float support is refused before drawing with a reflection-specific reason', () => {
  const context = createTestContext(),
    material = new G.GraphSurface('standard', { roughness: 0 });
  const copy = {
    material,
    geometry: { attributes: { position: new G.BufferAttribute(new Float32Array(9), 3) } },
  };
  assert.match(
    clusterWebglCompatibility(context.gl, [], [copy], { lights: [] })!,
    /reflections needs a half-float/,
  );
});
