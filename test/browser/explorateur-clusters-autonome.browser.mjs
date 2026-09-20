// Public exact-pages integration proof: beauty, diagnostics, capture and held frames keep paged
// clusters out of the temporary Three scene renderer.
//
//   node --experimental-strip-types test/browser/explorateur-clusters-autonome.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglClusterExplorerPage.mjs',
  'webglClusterExplorerProof',
  'Explorer autonomous clusters',
  'execute',
);
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
