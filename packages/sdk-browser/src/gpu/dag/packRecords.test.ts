// Placements of one primitive share their cluster records (#4), and the cut does not see it.
//
// The reference is the same packing with nothing shared: each placement handed a copy of its
// culling nodes, so no two placements have the same shape and every one keeps its own records.
// Both packings must select, draw and count exactly the same pages, pose after pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asHostLibrary } from '../../host/resources.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { packDagSelection, packedWorldsToRenderOrigin } from './pack.ts';
import { evaluateDagSelectionKernel } from './selection.ts';
import { cameraSelectionUniforms, PAGE_CONE_FLOATS } from '../core/selection.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { CLUSTER_WORDS, coldBase } from './layout.ts';
import { bandError, dagRecords, flagsOf, ownerOf, trianglesOf } from './records.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';
import type { DagRoot } from './types.ts';
import { ruleResidency } from './readiness.fixture.ts';

const pages = scenePages(1024, 6);
const PLACEMENTS = 12;

function placedRoots() {
  const roots = sceneRoots(
    pages,
    Array.from({ length: PLACEMENTS }, () => new G.Matrix4()),
  );
  roots.forEach((root, w) => {
    const world = asHostLibrary<G.Matrix4>(root.world);
    world.makeRotationY(w * 0.4);
    world.setPosition((w % 4) * 5 - 7.5, Math.floor(w / 4) * 4 - 4, -w * 0.5);
  });
  return roots;
}
const unshared = (roots: DagRoot[]) =>
  roots.map((root) => ({
    ...root,
    culling: { ...root.culling!, nodes: root.culling!.nodes.slice() },
  }));

test('twelve placements of one primitive store its records once', () => {
  const packed = packDagSelection(placedRoots());
  assert.equal(packed.pageCount, PLACEMENTS * pages.length);
  assert.equal(packed.recordCount, pages.length);
  assert.equal(packed.clusters.length, pages.length * CLUSTER_WORDS);
  const alone = packDagSelection(unshared(placedRoots()));
  assert.equal(alone.recordCount, PLACEMENTS * pages.length);
  // Hot records shrink by the placement count; the cold buffer keeps one working word per page.
  assert.equal(alone.clusters.byteLength / packed.clusters.byteLength, PLACEMENTS);
  const words = coldBase(packed.pageCount) + pages.length * PAGE_CONE_FLOATS;
  assert.equal(packed.pageCones.length, words);
});

test('every page decodes the same record, owner and placement shared or not', () => {
  const shared = dagRecords(packDagSelection(placedRoots())),
    alone = dagRecords(packDagSelection(unshared(placedRoots())));
  for (let i = 0; i < PLACEMENTS * pages.length; i++) {
    assert.equal(ownerOf(shared, i), ownerOf(alone, i));
    assert.equal(flagsOf(shared, i), flagsOf(alone, i));
    assert.equal(trianglesOf(shared, i), trianglesOf(alone, i));
  }
});

test('shared records select, draw and count exactly what unshared ones do', () => {
  const roots = placedRoots(),
    shared = packDagSelection(roots),
    alone = packDagSelection(unshared(roots));
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 200);
  const resident = Uint32Array.from({ length: shared.pageCount }, (_, i) => (i % 7 === 3 ? 0 : 1));
  let kept = 0;
  for (const [x, z] of [
    [0, 18],
    [9, 12],
    [-4, 40],
    [2, 3],
  ])
    for (const threshold of [0.5, 2, 8]) {
      cam.position.set(x, 1, z);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      const uniforms = cameraSelectionUniforms(cameraMoteur(cam), threshold, [1280, 720]);
      packedWorldsToRenderOrigin(shared, roots, uniforms.cameraWorld);
      packedWorldsToRenderOrigin(alone, roots, uniforms.cameraWorld);
      for (const mask of [undefined, resident]) {
        const a = evaluateDagSelectionKernel(shared, uniforms, mask && ruleResidency(shared, mask)),
          b = evaluateDagSelectionKernel(alone, uniforms, mask && ruleResidency(alone, mask));
        assert.deepEqual(a, b, `(${x}, ${z}) at ${threshold} px`);
        kept += a.pageIds.length;
      }
    }
  assert.ok(kept > 0, 'no page kept: the proof covers nothing');
});

test('a placement whose pages differ keeps its own records', () => {
  const roots = placedRoots();
  const changed = pages.map((page) => ({ ...page }));
  changed[0] = { ...changed[0], lodError: (changed[0].lodError ?? 0) + 1 };
  roots[5] = { ...roots[5], pages: changed as DagRoot['pages'] };
  const packed = packDagSelection(roots);
  assert.equal(packed.recordCount, 2 * pages.length);
  const records = dagRecords(packed);
  assert.equal(bandError(records, 5 * pages.length, 0), Math.fround(changed[0].lodError!));
  assert.equal(bandError(records, 4 * pages.length, 0), Math.fround(pages[0].lodError ?? 0));
});
