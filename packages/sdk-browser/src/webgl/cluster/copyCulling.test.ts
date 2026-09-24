import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { createHostDrawCamera, readHostDrawCamera } from '../../camera/world.ts';
import { WebglClusterCopies } from './copyCulling.ts';

const copyAt = (x: number, frustumCulled = true, material: G.GraphSurface = G.basicSurface()) => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([-1, -1, -3, 1, -1, -3, 0, 1, -3], 3));
  const copy = G.mesh(geometry, material);
  copy.frustumCulled = frustumCulled;
  copy.matrix.makeTranslation(x, 0, 0);
  return copy;
};

test('a scene copy outside the frustum is skipped unless it declares itself never culled, and each kept copy takes the pass its material asks for', () => {
  const camera = G.perspectiveCamera(60, 1, 0.1, 10),
    copies = new WebglClusterCopies<G.GraphMesh>(),
    glass = G.physicalSurface({ transmission: 1 }),
    blend = G.basicSurface({ transparent: true }),
    inView = copyAt(0),
    blended = copyAt(0, true, blend),
    away = copyAt(100),
    neverCulled = copyAt(100, false),
    glassInView = copyAt(0, true, glass),
    glassAway = copyAt(100, true, glass);
  copies.cull(
    [inView, away, neverCulled, glassInView, glassAway, blended],
    readHostDrawCamera(createHostDrawCamera(), camera),
  );
  assert.deepEqual(copies.plain, [inView, neverCulled], 'frustumCulled false always draws');
  assert.deepEqual(copies.transmissive, [glassInView]);
  assert.deepEqual(copies.blended, [blended], 'a blended copy draws after the transmissive ones');
  // The painted glass of a diagnostic mode no longer transmits: it draws as a whole mesh.
  glassInView.material = G.basicSurface();
  copies.cull([glassInView], readHostDrawCamera(createHostDrawCamera(), camera));
  assert.deepEqual([copies.plain, copies.blended, copies.transmissive], [[glassInView], [], []]);
});
