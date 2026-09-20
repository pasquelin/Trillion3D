// Standalone WebGL2 proof for clustered BLEND ordering, side passes, MASK and diagnostics.
//
//   node --experimental-strip-types test/browser/transparence-clusters-webgl.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglClusterTransparencyPage.mjs',
  'webglClusterTransparencyProof',
  'Autonomous clustered transparency',
  'execute',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.notDeepEqual(result.sourceOrder, result.reversedOrder, 'range order must affect overlap');
assert.equal(result.splitSubmissions, 2, 'back and front are two submitted passes');
assert.equal(result.singleSubmissions, 1, 'forceSinglePass submits one double-sided pass');
assert.equal(result.maskPixel[3], 255, 'MASK remains opaque after its cutoff');
assert.ok(result.blendPixel[2] > 0, 'BLEND preserves the blue destination');
assert.ok(result.coplanarPixel[1] > result.coplanarPixel[0], 'the raised coplanar layer wins');
assert.equal(result.diagnosticSubmissions, 1);
assert.ok(result.diagnosticPixel[0] + result.diagnosticPixel[1] > 0);
assert.equal(result.mutationRejected, true);
assert.deepEqual(result.rejectionPixel, [0, 0, 255, 255], 'preflight rejected before drawing');
