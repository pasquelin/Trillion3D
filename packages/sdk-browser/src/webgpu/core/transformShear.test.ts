// Defect 2: `setTransform` reduced the requested matrix to a translation-rotation-scale product,
// and `updateMatrixWorld` recomposed over the matrix that was set. Not every matrix being such a
// product, the engine then drew another transform than the one requested. These tests hold the
// effective world matrix — the one that leaves for the GPU through `root.world.elements` —
// against the requested one, on sheared matrices, under a parent, and on conformal cases that
// must not move. The world checked is the one THE ENGINE holds (`../../host/world/placements.ts`): since
// lot 8 it is what records, roots and the GPU carry, and the host scene is no longer climbed by
// the engine. Refusal of a non-finite pose is in `transformFiniteTransform.test.ts`,
// apart to keep both files under 200 lines; the fixtures are shared by both.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { BOX_VALUES, boxTransform, determinantMatrix4 } from '../../../../sdk-core/src/index.ts';
import { setWebgpuTransform } from '../pages/render/transform.ts';
import { cisaillee, proche, racine, runtime, scene, versGpu } from './transformShear.fixture.ts';

test('the requested sheared world matrix is the one the node carries, to the bit', () => {
  const { source, mesh, worlds } = scene(),
    { rt } = runtime(source, [], worlds),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(worlds.of(mesh).elements), Array.from(demandee));
});

test('a following image does not recompose the set matrix from position, rotation and scale', () => {
  const { source, mesh, worlds } = scene(),
    { rt } = runtime(source, [], worlds),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  worlds.refresh();
  worlds.refresh();
  assert.deepEqual(Array.from(worlds.of(mesh).elements), Array.from(demandee));
});

test('under a rotated and scaled parent, the obtained world stays the requested world', () => {
  const source = new G.GraphNode(),
    parent = new G.GraphNode(),
    mesh = G.mesh();
  mesh.name = 'cible';
  parent.position.set(2, -1, 3);
  parent.quaternion.copy(new G.Quaternion().setFromEuler(new G.Euler(0.3, -0.5, 0.2)));
  parent.scale.set(2, 0.5, 4);
  parent.add(mesh);
  source.add(parent);
  const { rt, worlds } = runtime(source),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  proche(worlds.of(mesh).elements, demandee, 1e-5, 'world under parent');
});

test('a parent itself sheared does not skew the requested world for its child', () => {
  const source = new G.GraphNode(),
    parent = new G.GraphNode(),
    mesh = G.mesh();
  mesh.name = 'cible';
  parent.add(mesh);
  source.add(parent);
  const { rt, worlds } = runtime(source);
  parent.name = 'porteur';
  setWebgpuTransform(rt, 'porteur', versGpu(cisaillee(2, 1)));
  const demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  proche(worlds.of(mesh).elements, demandee, 1e-5, 'world under sheared parent');
});

test('the matrix the selection root sends to the GPU carries the shear', () => {
  const { source, mesh, worlds } = scene(),
    root = racine(mesh, [-1, -1, -1, 1, 1, 1], worlds),
    { rt } = runtime(source, [root], worlds),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(root.world.elements), Array.from(demandee));
});

test('the reprojected world box is the image of the local box by the sheared matrix', () => {
  const { source, mesh, worlds } = scene(),
    local = [-1, -1, -1, 1, 1, 1],
    root = racine(mesh, local, worlds),
    avant = Array.from(root.worldBox!),
    { rt, mouvements } = runtime(source, [root], worlds),
    demandee = versGpu(cisaillee(3, 6));
  setWebgpuTransform(rt, 'cible', demandee);
  const attendu = new Float64Array(BOX_VALUES);
  boxTransform(attendu, 0, Float64Array.from(local), 0, demandee);
  assert.deepEqual(Array.from(root.worldBox!), Array.from(attendu));
  assert.equal(root.worldBox![0], 2, 'shear extends the box, a TRS decompose does not');
  assert.equal(mouvements.length, 1);
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(mouvements[0].min[axis], Math.min(avant[axis], attendu[axis]));
    assert.equal(mouvements[0].max[axis], Math.max(avant[axis + 3], attendu[axis + 3]));
  }
});

test('a conformal translation-rotation-scale matrix stays exact, fields included', () => {
  const { source, mesh, worlds } = scene(),
    { rt } = runtime(source, [], worlds),
    conforme = new G.Matrix4().compose(
      new G.Vector3(2, -1, 3),
      new G.Quaternion().setFromEuler(new G.Euler(0.3, -0.5, 0.2)),
      new G.Vector3(1.5, 1.5, 1.5),
    ),
    demandee = versGpu(conforme);
  setWebgpuTransform(rt, 'cible', demandee);
  assert.deepEqual(Array.from(worlds.of(mesh).elements), Array.from(demandee));
  proche([mesh.position.x, mesh.position.y, mesh.position.z], [2, -1, 3], 1e-6, 'position');
  proche([mesh.scale.x, mesh.scale.y, mesh.scale.z], [1.5, 1.5, 1.5], 1e-6, 'scale');
});

test('a negative scale keeps its negative determinant, therefore its face winding', () => {
  const { source, mesh, worlds } = scene(),
    { rt } = runtime(source, [], worlds),
    demandee = versGpu(new G.Matrix4().makeScale(1, -2, 3));
  setWebgpuTransform(rt, 'cible', demandee);
  const monde = worlds.of(mesh);
  assert.deepEqual(Array.from(monde.elements), Array.from(demandee));
  assert.ok(determinantMatrix4(Float64Array.from(monde.elements)) < 0, 'negative determinant kept');
});

test('two successive moves do not accumulate and the scene is declared moved', () => {
  const { source, mesh, worlds } = scene(),
    { rt, layout, run } = runtime(source, [], worlds),
    premier = versGpu(cisaillee(3, 6)),
    second = versGpu(cisaillee(-2, -4));
  setWebgpuTransform(rt, 'cible', premier);
  setWebgpuTransform(rt, 'cible', second);
  assert.deepEqual(Array.from(worlds.of(mesh).elements), Array.from(second));
  // The table keeps its age and the scene its occlusion history: only the rows of a moved root
  // are rewritten (`movedRoot.ts`), and no root is drawn here.
  assert.equal(layout.rows.tableEpoch, 0);
  assert.equal(run.noOccluderHistory, false);
  // Without this increment, the image gate would hold the previous image and the moved node
  // would stay drawn where it was; `worldsRevision` follows, the hierarchy already carrying these
  // matrices.
  assert.equal(run.gate.revisions.scene, 3, 'one scene revision per move');
  // The hierarchy already carries this revision's matrices: nothing to climb.
  assert.equal(run.gate.updateWorlds(worlds), false);
});
