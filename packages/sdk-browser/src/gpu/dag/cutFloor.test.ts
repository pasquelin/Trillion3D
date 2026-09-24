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
import { asHostLibrary } from '../../host/resources.ts';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { packDagSelection, packedWorldsToRenderOrigin } from './pack.ts';
import { DAG_SELECTION_SHADER, evaluateDagSelectionKernel } from './selection.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { dagRecords, flagsOf, worldOf } from './records.ts';
import { CLUSTER_ROOT } from './layout.ts';
import { dagViewFrames } from './oracle/math.ts';
import { dagOracleDescent } from './oracle/descent.ts';
import { createDagOraclePredicates } from './oracle/predicates.ts';
import { descenteComptee } from './cutFrontier.fixture.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';

const pages = scenePages(4096, 8);
const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 200);

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

/** Every pose at every threshold, the four worlds placed on their grid: the uniforms of each case. */
function* cases(packed: ReturnType<typeof packDagSelection>, roots: ReturnType<typeof sceneRoots>) {
  for (const [nom, x, z] of POSES)
    for (const seuil of SEUILS) {
      for (let w = 0; w < roots.length; w++)
        asHostLibrary<G.Matrix4>(roots[w].world).makeTranslation(
          (w % 2) * 6.5 - 3.25,
          Math.floor(w / 2) * 6.5 - 3.25,
          0,
        );
      cam.position.set(x, 0, z);
      cam.lookAt(x, 0, 0);
      cam.updateMatrixWorld();
      const uniforms = cameraSelectionUniforms(cameraMoteur(cam), seuil, [1280, 720]);
      packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
      yield { cas: `${nom} at ${seuil} px`, uniforms };
    }
}

const sceneFor = (parNiveaux: boolean) => {
  const roots = sceneRoots(
    pages,
    Array.from({ length: 4 }, () => new G.Matrix4()),
    parNiveaux,
  );
  return { roots, packed: packDagSelection(roots) };
};

for (const parNiveaux of [false, true]) {
  const nomHierarchie = parNiveaux ? 'compiler hierarchy' : 'packing hierarchy';
  test(`${nomHierarchie}: top-down pruning removes no kept cluster`, () => {
    const { roots, packed } = sceneFor(parNiveaux);
    let elagages = 0;
    for (const { cas, uniforms } of cases(packed, roots)) {
      const attendu = coupeSansElagage(packed, uniforms);
      const obtenu = [...evaluateDagSelectionKernel(packed, uniforms).pageIds].sort(
        (a, b) => a - b,
      );
      assert.deepEqual(obtenu, attendu, cas);
      elagages += descenteComptee(packed, uniforms, true).plancherCoupe;
    }
    // Without pruning the proof would be empty: the threshold says the bound did cut somewhere.
    assert.ok(elagages > 0, `no subtree pruned: the proof covers nothing`);
  });

  // The edge case of `pruneCrossed` (`shader/floorWgsl.ts`), mirrored at `oracle/oracle.ts`: the
  // kept cut is missing, escalation raises the threshold toward coarser levels, and those levels
  // are the ones the descent pruned. Without the fallback the primitive draws nothing and says
  // it is complete — a hole no total reports. Three frames, each carrying the last one's final
  // thresholds as `resetPrune` does: crossing, holding, recovered.
  test(`${nomHierarchie}: escalation past a pruned floor draws the pinned roots, then recovers`, () => {
    const { roots, packed } = sceneFor(parNiveaux);
    const records = dagRecords(packed);
    const deMonde = (ids: readonly number[], w: number) =>
      ids.filter((i) => worldOf(records, i) === w).sort((a, b) => a - b);
    const racine = (i: number) => !!(flagsOf(records, i) & CLUSTER_ROOT);
    const complet = (r: ReturnType<typeof evaluateDagSelectionKernel>, cas: string) => {
      assert.equal(r.complete, true, cas);
      assert.equal(r.uncoveredTriangles, 0, cas);
    };
    let franchis = 0;
    for (const { cas, uniforms } of cases(packed, roots)) {
      const { prunedFloor } = dagOracleDescent(packed, dagViewFrames(packed, uniforms));
      const gardees = evaluateDagSelectionKernel(packed, uniforms).pageIds;
      // The roots alone cover the primitive: the cut at a threshold no replacement meets.
      const racines = coupeSansElagage(packed, { ...uniforms, pixelError: 3.4e38 });
      // Crossing frame, fresh: everything is resident except the cut the view wants.
      const resident = new Uint32Array(packed.pageCount).fill(1);
      for (const i of gardees) resident[i] = 0;
      const croise = evaluateDagSelectionKernel(packed, uniforms, resident);
      // Holding frame, same residency: the carried threshold keeps the pruned coarse levels.
      const tient = evaluateDagSelectionKernel(
        packed,
        uniforms,
        resident,
        false,
        croise.finalThresholds,
      );
      complet(croise, cas);
      complet(tient, cas);
      for (let w = 0; w < roots.length; w++) {
        const voulues = deMonde(gardees, w);
        if (!voulues.length) continue;
        const dessinees = deMonde(croise.drawablePageIds ?? [], w);
        assert.ok(dessinees.length, `${cas}, world ${w}: a hole where the cut was missing`);
        if (!dessinees.every(racine) || voulues.every(racine)) continue;
        // A fallback is the WHOLE pinned cover, and only past a floor the descent dropped.
        assert.deepEqual(dessinees, deMonde(racines, w), `${cas}, world ${w}`);
        assert.ok(prunedFloor[w] < Infinity, `${cas}, world ${w}: fallback with nothing pruned`);
        franchis++;
        // One frame later the escalated cut replaces the roots: the fallback lasts one frame.
        const escalade = coupeSansElagage(packed, {
          ...uniforms,
          pixelError: croise.finalThresholds[w],
        });
        const tenues = deMonde(tient.drawablePageIds ?? [], w);
        assert.deepEqual(tenues, deMonde(escalade, w), `${cas}, world ${w}: holding frame`);
        assert.ok(!tenues.every(racine), `${cas}, world ${w}: still on the roots`);
      }
      // The wanted cut has arrived: the finer levels come back, whole, the threshold carried.
      const retour = evaluateDagSelectionKernel(
        packed,
        uniforms,
        resident.fill(1),
        false,
        tient.finalThresholds,
      );
      complet(retour, cas);
      assert.deepEqual(
        [...(retour.drawablePageIds ?? [])].sort((a, b) => a - b),
        [...gardees].sort((a, b) => a - b),
        cas,
      );
    }
    assert.ok(franchis > 0, 'no escalation crossed a pruned floor: the proof covers nothing');
    // The kernel does what the oracle replays: `resetPrune` carries the last final threshold,
    // `dagMask` reads `pruneCrossed` beside the missing flag, and `pruneCrossed` compares the
    // final threshold with the smallest floor dropped. Node does not run WGSL: its execution is
    // `tests/browser/probes/top-pruning-gpu.ts`'s.
    assert.match(DAG_SELECTION_SHADER, /select\(seuil,carried,carried>seuil&&carried<INF\)/);
    assert.match(
      DAG_SELECTION_SHADER,
      /atomicLoad\(&work\[slots\(\)\+slot\]\)!=0u\|\|pruneCrossed\(slot\)/,
    );
    assert.match(
      DAG_SELECTION_SHADER,
      /fn pruneCrossed\(slot:u32\)->bool\{return bitcast<f32>\(atomicLoad\(&work\[slot\]\)\)>bitcast<f32>\(atomicLoad\(&work\[floorSlot\(slot\)\]\)\);\}/,
    );
  });
}
