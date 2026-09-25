import assert from 'node:assert/strict';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { createHostDrawCamera, readHostDrawCamera } from '../../camera/world.ts';
import { GraphInstancedMesh } from '../../host/graph/mesh.ts';
import { WebglClusterCopies } from './copyCulling.ts';

const copyAt = (x: number, frustumCulled = true, material: G.GraphSurface = G.basicSurface()) => {
  const geometry = new G.Geometry();
  geometry.setAttribute('position', G.floatAttribute([-1, -1, -3, 1, -1, -3, 0, 1, -3], 3));
  const copy = G.mesh(geometry, material);
  copy.frustumCulled = frustumCulled;
  copy.position.set(x, 0, 0);
  copy.updateMatrixWorld();
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

// Issue #275: a copy is culled at its WORLD box — a parent carries it — and an instanced copy on
// its placements' bounds, never on its geometry's box alone.
test('a copy is culled where its parent and its placements carry it', () => {
  const camera = readHostDrawCamera(createHostDrawCamera(), G.perspectiveCamera(60, 1, 0.1, 10)),
    copies = new WebglClusterCopies<G.GraphMesh>();
  const carried = copyAt(0),
    parent = new G.Group();
  parent.position.set(100, 0, 0);
  parent.add(carried);
  parent.updateMatrixWorld();
  const source = copyAt(0),
    placed = new GraphInstancedMesh(source.geometry, G.basicSurface(), 1);
  placed.instanceMatrix.array.set(new G.Matrix4().makeTranslation(100, 0, 0).elements);
  placed.updateMatrixWorld();
  const placedBack = new GraphInstancedMesh(source.geometry, G.basicSurface(), 1);
  placedBack.position.set(100, 0, 0);
  placedBack.instanceMatrix.array.set(new G.Matrix4().makeTranslation(-100, 0, 0).elements);
  placedBack.updateMatrixWorld();
  copies.cull([carried, placed, placedBack], camera);
  assert.deepEqual(copies.plain, [placedBack], 'only the copy its placement brings into view');
});
