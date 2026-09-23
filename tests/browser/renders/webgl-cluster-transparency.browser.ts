// Standalone WebGL2 proof for clustered BLEND ordering, side passes, MASK and diagnostics.
//
//   node --experimental-strip-types tests/browser/renders/webgl-cluster-transparency.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface Resultat extends ResultatPagePreuve {
  sourceOrder: unknown;
  reversedOrder: unknown;
  splitSubmissions: number;
  singleSubmissions: number;
  maskPixel: number[];
  blendPixel: number[];
  coplanarPixel: number[];
  coplanarBlendSubmissions: number;
  coplanarBlendWithoutBias: number[];
  coplanarBlendPixel: number[];
  diagnosticSubmissions: number;
  diagnosticPixel: number[];
  mutationRejected: boolean;
  rejectionPixel: number[];
  hiddenSubmissions: number;
  hiddenPixel: number[];
  sourceMutationRejected: boolean;
  sourceRejectionPixel: number[];
}

const result = (await preuveDansLaPage(
  'webglClusterTransparencyPage.ts',
  'webglClusterTransparencyProof',
  'Autonomous clustered transparency',
  'execute',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.notDeepEqual(result.sourceOrder, result.reversedOrder, 'range order must affect overlap');
assert.equal(result.splitSubmissions, 2, 'back and front are two submitted passes');
assert.equal(result.singleSubmissions, 1, 'forceSinglePass submits one double-sided pass');
assert.equal(result.maskPixel[3], 255, 'MASK remains opaque after its cutoff');
assert.ok(result.blendPixel[2] > 0, 'BLEND preserves the blue destination');
assert.ok(result.coplanarPixel[1] > result.coplanarPixel[0], 'the raised coplanar layer wins');
assert.equal(
  result.coplanarBlendSubmissions,
  3,
  'opaque base plus both BLEND passes are submitted',
);
assert.deepEqual(result.coplanarBlendWithoutBias, [255, 0, 0, 255]);
assert.ok(result.coplanarBlendPixel[1] > 0 && result.coplanarBlendPixel[0] < 255);
assert.equal(result.diagnosticSubmissions, 1);
assert.ok(result.diagnosticPixel[0] + result.diagnosticPixel[1] > 0);
assert.equal(result.mutationRejected, true, 'a material array is refused by name');
assert.deepEqual(result.rejectionPixel, [0, 0, 255, 255], 'preflight rejected before drawing');
assert.equal(result.hiddenSubmissions, 0, 'source visibility suppresses both generated passes');
assert.deepEqual(result.hiddenPixel, [0, 0, 255, 255]);
assert.equal(result.sourceMutationRejected, true);
assert.deepEqual(
  result.sourceRejectionPixel,
  [0, 0, 255, 255],
  'source preflight rejected before drawing',
);
