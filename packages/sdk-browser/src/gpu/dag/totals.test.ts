// Triangle totals have switched sides: the CPU used to sum them by walking the cut delta
// (`../../webgpu/cut/counts.ts`), the GPU now holds them in `dagMask` (`shader/totalsWgsl.ts`).
//
// This test holds both halves of the contract:
// ① the invariant the CPU documented — `selected − drawn − uncovered = 0` — on a frame where
//    residency REALLY digs a hole, without which it would hold on zeros;
// ② agreement with the CPU sum, where the two definitions coincide: a cut whose every drawable
//    page has its bytes and its row. That is what authorises dropping the sum.
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
import { createCutDelta } from '../../webgpu/cut/delta.ts';
import { createCutCounts } from '../../webgpu/cut/counts.ts';
import type { PageRec } from '../../page/selection/selection.ts';

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

/** The catalogue the CPU sum reads: same ranks as the cut, same triangles. */
const catalogue = (pages: ReturnType<typeof scene>['pages']) =>
  pages.map(
    (page, id) =>
      ({
        id,
        url: page.url,
        triangles: page.triangles,
        transparent: page.transparent,
        array: Uint32Array.of(0, 1, 2),
      }) as unknown as PageRec,
  );

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
  assert.ok(uncoveredTriangles! > 0, 'residency must dig a hole, otherwise the invariant is empty');
  assert.ok(drawnTriangles! > 0, 'and the frame must still draw');
  assert.equal(selectedTriangles! - drawnTriangles! - uncoveredTriangles!, 0);
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
  assert.ok(releve.transparentTriangles! < releve.selectedTriangles!, 'and not all of them');
});

test('the GPU and the CPU sum give the same totals when the CPU is missing nothing', () => {
  const recs = catalogue(scene(1).pages);
  // Every page has its row and its bytes: the CPU's hole is empty, and its definition then meets
  // the GPU's — the full drawable cut.
  const offsets = new Int32Array(recs.length).fill(0);
  const drawnDelta = createCutDelta(recs);
  const counts = createCutCounts(recs, offsets, drawnDelta);
  for (const seuil of [0.25, 0.5, 1, 2]) {
    const { packed, uni } = scene(seuil);
    const releve = evaluateDagSelectionKernel(packed, uni);
    drawnDelta.apply(releve.drawablePageIds!);
    const totaux = counts.apply();
    assert.equal(totaux.selectedTriangles, releve.selectedTriangles, `threshold ${seuil}: cut`);
    assert.equal(totaux.drawnTriangles, releve.drawnTriangles, `threshold ${seuil}: draw`);
    assert.equal(totaux.uncoveredTriangles, releve.uncoveredTriangles, `threshold ${seuil}: hole`);
    assert.equal(
      totaux.transparentTriangles,
      releve.transparentTriangles,
      `threshold ${seuil}: blend`,
    );
  }
});
