// Batch M3a, parent/child cases: the same operations replayed on a real host-library `Object3D` and
// cameras (`hierarchyReplayThree.ts`) and on the sdk-core hierarchy (`hierarchyReplayEngine.ts`),
// compared component by component with `Object.is` — `NaN` accepted on both sides at the same place.
// The scenarios (`hierarchieScenarios*.ts`) cover: depth ≥ 4 chains with a two-child
// branch, negative scale on one axis and zero scale, parent rotation on non-uniform scale,
// camera child of a node, reparenting, partial marking (`updateWorldMatrix`), `lookAt` (direction
// collinear with up, mirrored parent, zero-scale parent), and degenerate projections in both
// depth conventions. The host library is used only to compare, never in a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joueNous } from '../../../../../bench/perf/browser/support/hierarchyReplayEngine.ts';
import { joueThree } from '../../../../../bench/perf/browser/support/hierarchyReplayThree.ts';
import { chainesFigees } from '../../../../../bench/perf/browser/support/hierarchyScenarios.ts';
import type { HierarchyOp } from '../../../../../bench/perf/browser/support/hierarchyScenarios.ts';
import {
  objectifs,
  visees,
} from '../../../../../bench/perf/browser/support/hierarchyScenariosCamera.ts';
import {
  marquages,
  liveScenario,
} from '../../../../../bench/perf/browser/support/hierarchyScenariosLive.ts';

// `witnessNaN`: the host library builds an off-axis rectangle, so a degenerate camera (zero zoom,
// zero near, a vanishing field) turns its centring terms into inf - inf or 0 / 0. The engine's
// projection is centred by construction and never computes them: where the host gives NaN it
// gives the finite or infinite value the same inputs define, and never a NaN of its own.
function compare(scenario: HierarchyOp[], label: string, witnessNaN = false) {
  const attendu = joueThree(scenario);
  const obtenu = joueNous(scenario);
  assert.equal(obtenu.length, attendu.length, `${label}: number of outputs`);
  for (let i = 0; i < attendu.length; i++) {
    const a = attendu[i],
      b = obtenu[i];
    assert.equal(b.length, a.length, `${label}, output ${i}: length`);
    for (let k = 0; k < a.length; k++)
      assert.ok(
        Object.is(a[k], b[k]) || (witnessNaN && Number.isNaN(a[k]) && !Number.isNaN(b[k])),
        `${label}, output ${i}[${k}]: ${a[k]} ≠ ${b[k]}`,
      );
  }
}

test('finite frozen chains: depth ≥ 4, two-child branch, negative and zero scale, parent rotation on non-uniform scale, child camera — identical to the host library bit-exact', () => {
  const scenario = chainesFigees(false);
  assert.ok(scenario.length > 500, `${scenario.length} operations, scenario too small`);
  compare(scenario, 'chainesFigees(false)');
});

test('frozen chains with NaN and infinities: same NaNs and infinities at the same place on both sides', () => {
  compare(chainesFigees(true), 'chainesFigees(true)');
});

test('live scene: reparenting, partial marking (updateWorldMatrix), removals, lookAt, camera frames — snapshots identical to the host library, frame after frame', () => {
  compare(liveScenario(60, 14, 6), 'scenarioVivant ordinaire');
});

test('hostile live scene: more frequent NaN/infinite poses — still identical to the host library', () => {
  compare(liveScenario(40, 10, 3), 'scenarioVivant hostile');
});

test('exact marking rules: matrixWorldNeedsUpdate, force, detached subtree, reattach under a higher index, remove then reuse — identical to the host library', () => {
  compare(marquages(), 'marquages');
});

test('look-ats: object and camera lookAt, ordinary/on-eye/NaN/infinite targets, collinear up, mirrored and zero-scale parent — identical to the host library', () => {
  compare(visees(), 'visees');
});

test('projections: field, aspect, near/far and zoom ordinary and degenerate, WebGL and WebGPU, view, view-projection and planes — identical to the host library, except where only the host produces a NaN', () => {
  compare(objectifs(), 'objectifs', true);
});
