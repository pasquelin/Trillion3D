// Real-rAF BLEND submission proof, one render per callback, diagnostics disabled.
//
//   node --experimental-strip-types test/browser/performance-blend-clusters-webgl.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../appui/preuvePageMoteur.ts';

interface Mesure {
  samples: number;
}

interface Resultat extends ResultatPagePreuve {
  ownA: Mesure;
  reference: Mesure;
  ownB: Mesure;
}

const result = (await preuveDansLaPage(
  'webglClusterBlendPerfPage.ts',
  'webglClusterBlendPerfProof',
  'Autonomous clustered BLEND performance',
  'measureBlend',
)) as Resultat;
console.log(JSON.stringify(result, null, 2));
preuveSaine(result);
assert.equal(result.ownA.samples, 120);
assert.equal(result.reference.samples, 120);
assert.equal(result.ownB.samples, 120);
