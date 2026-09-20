// Real-rAF BLEND submission proof, one render per callback, diagnostics disabled.
//
//   node --experimental-strip-types test/browser/performance-blend-clusters-webgl.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const result = await preuveDansLaPage(
  'webglClusterBlendPerfPage.mjs',
  'webglClusterBlendPerfProof',
  'Autonomous clustered BLEND performance',
  'measureBlend',
);
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.equal(result.ownA.samples, 120);
assert.equal(result.reference.samples, 120);
assert.equal(result.ownB.samples, 120);
