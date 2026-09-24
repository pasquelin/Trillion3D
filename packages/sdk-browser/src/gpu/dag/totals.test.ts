// Triangle totals are held by the GPU alone, in `dagMask` (`shader/totalsWgsl.ts`): the CPU sums
// none. This test holds the contract:
// ① the invariant `selected − drawn − uncovered = 0` on a frame where residency REALLY digs a
//    hole, without which it would hold on zeros;
// ② each total is the sum of the pages the readback declares drawable, at every threshold,
//    when nothing is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './selection.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

const VIEWPORT: [number, number] = [1280, 720];

/** The frontier-count scene, whose every page carries a varying triangle count, and of which one
 *  in seven is blended: without that, `transparentTriangles` would agree on zero. */
function scene(seuil: number, z = 16) {
  const pages = scenePages(4096, 8).map((page, i) => ({ ...page, transparent: i % 7 === 0 }));
  const roots = sceneRoots(pages, [new G.Matrix4()], true);
  const packed = packDagSelection(roots);
  const uni = uniforms(seuil, z);
  // The kernel works in the render frame: without rebasing, a relative view and an absolute world
  // would mix and the cut would be empty — silently, which would check everything on nothing.
  packedWorldsToRenderOrigin(packed, roots, uni.cameraWorld);
  return { pages, packed, uni };
}

function uniforms(seuil: number, z = 16) {
  const camera = G.perspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200);
  camera.position.set(0, 0, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return cameraSelectionUniforms(cameraMoteur(camera), seuil, VIEWPORT);
}

test('the three totals are taken on the full drawable cut, hole included', () => {
  const { pages, packed, uni } = scene(1);
  // One page in three resident: the cut will want to draw what is missing, and the hole will be real.
  const resident = Uint32Array.from({ length: packed.pageCount }, (_, id) => (id % 3 ? 0 : 1));
  const releve = evaluateDagSelectionKernel(packed, uni, resident);
  const { selectedTriangles, drawnTriangles, uncoveredTriangles, drawablePageIds } = releve;
  assert.ok(uncoveredTriangles > 0, 'residency must dig a hole, otherwise the invariant is empty');
  assert.ok(drawnTriangles > 0, 'and the frame must still draw');
  assert.equal(selectedTriangles - drawnTriangles - uncoveredTriangles, 0);
  // `drawn` is exactly the sum of the pages the readback declares drawable — no more, no less.
  const somme = (ids: readonly number[]) =>
    ids.reduce((total, id) => total + (pages[id].triangles as number), 0);
  assert.equal(drawnTriangles, somme(drawablePageIds!));
});

test('the blended share is taken on the same set as the total', () => {
  const { pages, packed, uni } = scene(1);
  const releve = evaluateDagSelectionKernel(packed, uni);
  const dessinables = releve.drawablePageIds!;
  const attendu = dessinables
    .filter((id) => pages[id].transparent)
    .reduce((total, id) => total + (pages[id].triangles as number), 0);
  assert.ok(attendu > 0, 'the scene must carry blended clusters');
  assert.equal(releve.transparentTriangles, attendu);
  assert.ok(releve.transparentTriangles < releve.selectedTriangles, 'and not all of them');
});

test('with nothing missing, every total is the sum of the drawable pages', () => {
  const { pages } = scene(1);
  const somme = (ids: readonly number[], blended = false) =>
    ids
      .filter((id) => !blended || pages[id].transparent)
      .reduce((total, id) => total + (pages[id].triangles as number), 0);
  for (const seuil of [0.25, 0.5, 1, 2]) {
    const { packed, uni } = scene(seuil);
    const releve = evaluateDagSelectionKernel(packed, uni);
    const dessinables = releve.drawablePageIds!;
    assert.equal(releve.selectedTriangles, somme(dessinables), `threshold ${seuil}: cut`);
    assert.equal(releve.drawnTriangles, somme(dessinables), `threshold ${seuil}: draw`);
    assert.equal(releve.uncoveredTriangles, 0, `threshold ${seuil}: hole`);
    assert.equal(
      releve.transparentTriangles,
      somme(dessinables, true),
      `threshold ${seuil}: blend`,
    );
  }
});
