// Top-down pruning removes no cluster the cut would have kept.
//
// The descent drops a subtree whose error FLOOR exceeds the threshold: none of its
// clusters is fine enough, so none would have been kept. The bound is a lower bound, and an
// OVERESTIMATED lower bound silently drops geometry — that is the batch's only risk, and it is
// what this file forbids.
//
// The reference is not another formula: it is the SAME oracle, every node opened. The cut
// obtained with the full page-by-page descent must be the one the pruned descent returns.
// Both read the same f32 records: what separates them is the pruning, and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packDagSelection, packedWorldsToRenderOrigin } from './gpuDagPack.ts';
import { evaluateDagSelectionKernel } from './gpuDagSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { dagRecords, worldOf } from './gpuDagLayout.ts';
import { dagViewFrames } from './gpuDagOracleMath.ts';
import { createDagOraclePredicates } from './gpuDagOraclePredicates.ts';
import { descenteComptee } from './gpuDagCutFrontierFixture.ts';
import { scenePages, sceneRoots } from './gpuDagCutFrontierScene.ts';

const pages = scenePages(4096, 8);
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

/** The cut a descent WITHOUT pruning would return: every node opened, so the only remaining
 *  filter is the one `dagWanted` sets per cluster — frustum, cone, error band. */
function coupeSansElagage(packed: ReturnType<typeof packDagSelection>, uniforms: unknown) {
  const frames = dagViewFrames(packed, uniforms as Parameters<typeof dagViewFrames>[1]);
  const records = dagRecords(packed);
  const { coneRejects, visible, selects } = createDagOraclePredicates({
    packed,
    records,
    nodeFlags: new Uint8Array(Math.max(1, packed.nodeCount)),
    ...frames,
  });
  const retenues: number[] = [];
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (visible(i) && selects(i, frames.pixelError) && !coneRejects(i, w)) retenues.push(i);
  }
  return retenues;
}

const POSES: Array<[string, number, number]> = [
  ['front', 0, 16],
  ['oblique', 9, 14],
  ['far', 0, 60],
  ['contact', 1.5, 3],
];
const SEUILS = [0.25, 1, 4];

for (const parNiveaux of [false, true]) {
  const nomHierarchie = parNiveaux ? 'compiler hierarchy' : 'packing hierarchy';
  test(`${nomHierarchie}: top-down pruning removes no kept cluster`, () => {
    const roots = sceneRoots(
      pages,
      Array.from({ length: 4 }, () => new THREE.Matrix4()),
      parNiveaux,
    );
    const packed = packDagSelection(roots);
    let elagages = 0;
    for (const [nom, x, z] of POSES)
      for (const seuil of SEUILS) {
        for (let w = 0; w < roots.length; w++)
          roots[w].world.makeTranslation((w % 2) * 6.5 - 3.25, Math.floor(w / 2) * 6.5 - 3.25, 0);
        cam.position.set(x, 0, z);
        cam.lookAt(x, 0, 0);
        cam.updateMatrixWorld();
        const uniforms = cameraSelectionUniforms(cameraMoteur(cam), seuil, [1280, 720]);
        packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
        const attendu = coupeSansElagage(packed, uniforms);
        const obtenu = [...evaluateDagSelectionKernel(packed, uniforms).pageIds].sort(
          (a, b) => a - b,
        );
        assert.deepEqual(obtenu, attendu, `${nom} at ${seuil} px`);
        elagages += descenteComptee(packed, uniforms, true).plancherCoupe;
      }
    // Without pruning the proof would be empty: the threshold says the bound did cut somewhere.
    assert.ok(elagages > 0, `no subtree pruned: the proof covers nothing`);
  });
}
