// Batch M3a, parent/child cases: the same operations replayed on real Three.js `Object3D` and
// cameras (`hierarchieRejeuThree.ts`) and on the sdk-core hierarchy (`hierarchieRejeuNous.ts`),
// compared component by component with `Object.is` — `NaN` accepted on both sides at the same place.
// The scenarios (`hierarchieScenarios*.ts`) cover: depth ≥ 4 chains with a two-child
// branch, negative scale on one axis and zero scale, parent rotation on non-uniform scale,
// camera child of a node, reparenting, partial marking (`updateWorldMatrix`), `lookAt` (direction
// collinear with up, mirrored parent, zero-scale parent), and degenerate projections in both
// depth conventions. Three is used only as a reference, never in a `math*.ts` file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { joueNous } from '../sdk-browser/bench/appui/hierarchieRejeuNous.ts';
import { joueThree } from '../sdk-browser/bench/appui/hierarchieRejeuThree.ts';
import { chainesFigees } from '../sdk-browser/bench/appui/hierarchieScenarios.ts';
import type { HierarchyOp } from '../sdk-browser/bench/appui/hierarchieScenarios.ts';
import { objectifs, visees } from '../sdk-browser/bench/appui/hierarchieScenariosCamera.ts';
import { marquages, liveScenario } from '../sdk-browser/bench/appui/hierarchieScenariosVivants.ts';

function compare(scenario: HierarchyOp[], label: string) {
  const attendu = joueThree(scenario);
  const obtenu = joueNous(scenario);
  assert.equal(obtenu.length, attendu.length, `${label}: number of outputs`);
  for (let i = 0; i < attendu.length; i++) {
    const a = attendu[i],
      b = obtenu[i];
    assert.equal(b.length, a.length, `${label}, output ${i}: length`);
    for (let k = 0; k < a.length; k++)
      assert.ok(Object.is(a[k], b[k]), `${label}, output ${i}[${k}]: ${a[k]} ≠ ${b[k]}`);
  }
}

test('finite frozen chains: depth ≥ 4, two-child branch, negative and zero scale, parent rotation on non-uniform scale, child camera — identical to Three bit-exact', () => {
  const scenario = chainesFigees(false);
  assert.ok(scenario.length > 500, `${scenario.length} operations, scenario too small`);
  compare(scenario, 'chainesFigees(false)');
});

test('frozen chains with NaN and infinities: same NaNs and infinities at the same place on both sides', () => {
  compare(chainesFigees(true), 'chainesFigees(true)');
});

test('live scene: reparenting, partial marking (updateWorldMatrix), removals, lookAt, camera frames — snapshots identical to Three, frame after frame', () => {
  compare(liveScenario(60, 14, 6), 'scenarioVivant ordinaire');
});

test('hostile live scene: more frequent NaN/infinite poses — still identical to Three', () => {
  compare(liveScenario(40, 10, 3), 'scenarioVivant hostile');
});

test('exact marking rules: matrixWorldNeedsUpdate, force, detached subtree, reattach under a higher index, remove then reuse — identical to Three', () => {
  compare(marquages(), 'marquages');
});

test('look-ats: object and camera lookAt, ordinary/on-eye/NaN/infinite targets, collinear up, mirrored and zero-scale parent — identical to Three', () => {
  compare(visees(), 'visees');
});

test('projections: field, aspect, near/far and zoom ordinary and degenerate, WebGL and WebGPU, view, view-projection and planes — identical to Three', () => {
  compare(objectifs(), 'objectifs');
});
