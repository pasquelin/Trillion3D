// Public exact-pages integration proof: beauty, diagnostics, capture and held frames keep paged
// clusters out of the temporary Three scene renderer.
//
//   node --experimental-strip-types tests/browser/renders/explorateur-clusters-autonome.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/preuvePageMoteur.ts';

interface Resultat extends ResultatPagePreuve {
  beautyDraws: number;
  selectedIds: string[];
  beautyCounts: number[];
  diagnosticDraws: number;
  diagnosticCounts: number[];
  captureDraws: number;
  held: boolean;
  hostCalls: number;
  pagedHostCalls: number;
}

const result = (await preuveDansLaPage(
  'webglClusterExplorerPage.ts',
  'webglClusterExplorerProof',
  'MeasuredWorld autonomous clusters',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.ok(result.beautyDraws > 0);
assert.deepEqual(result.selectedIds, ['0/0/0'], 'the autonomous cut is directly observable');
assert.deepEqual(result.beautyCounts, [2, 2, 2]);
assert.ok(result.diagnosticDraws > 0);
assert.deepEqual(result.diagnosticCounts, [1, 1, 1]);
assert.ok(result.captureDraws > 0);
assert.equal(result.held, true);
assert.ok(result.hostCalls > 0, 'the host renderer witness was not exercised');
assert.equal(result.pagedHostCalls, 0, 'a paged cluster entered WebGLRenderer.render');
