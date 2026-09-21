// Proof on the real engine: a moved host rig, still scene, unchanged cut — the PROJECTED
// bounds sent to the Hi-Z test are those of the new view.
//
// Those bounds are screen rectangles, which GPU partition computes per frame from the view
// matrices the CPU sends it. Under a rig the camera has no new local pose: without resolving
// the ancestor chain those matrices would be the previous view's and Hi-Z would decide on
// another view's rectangles. The two halves of the proof:
//   (a) the rig moves → the image matches a fresh engine placed at the same world pose,
//       byte for byte;
//   (b) the following still image still matches — and it was not held, so it was drawn
//       from the same matrices rather than copied.
//
//   node --experimental-strip-types test/browser/hiz-rig-camera.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../appui/preuvePageMoteur.ts';

interface EtapeRig {
  x: number;
  clusters: number;
  ecart: number;
  lignesApresDeplacement: number;
  lignesImmobile: number;
  tenueImmobile: boolean;
  ecartImmobile: number;
  dalle: number;
}

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
  etapes: EtapeRig[];
}

const resultat = (await preuveDansLaPage('hizRigPage.ts', 'hizRig', 'Moved host rig')) as Resultat;
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, etapes: resultat.etapes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const etapes = resultat.etapes;
assert.ok(etapes.length >= 4, 'the proof must count several rig poses');
for (const etape of etapes) {
  assert.equal(
    etape.clusters,
    etapes[0].clusters,
    `the cut changed at ${etape.x}: the proof required identical pages`,
  );
  assert.equal(
    etape.ecart,
    0,
    `at ${etape.x}, the rig image and the fresh engine differ on ${etape.ecart} pixels: ` +
      'screen rectangles from a previous view are still being tested',
  );
}
// (a) and (b): partition processes every drawable row each frame, and both images of each
// pose match the witness. A held frame encodes nothing and counts nothing — it would not
// prove rig resolution, it would bypass it.
for (const etape of etapes) {
  assert.ok(
    etape.lignesApresDeplacement > 0 && etape.lignesImmobile === etape.lignesApresDeplacement,
    `at ${etape.x}, partition did not process the same rows on both frames`,
  );
  assert.equal(etape.tenueImmobile, false, `at ${etape.x}, the still frame was held`);
  assert.equal(
    etape.ecartImmobile,
    0,
    `at ${etape.x}, the still image differs from the witness on ${etape.ecartImmobile} pixels: ` +
      'matrices from a previous view are still being projected',
  );
}
// Without an occlusion flip along the poses, equality with the witness would prove nothing:
// the far slab must be occluded somewhere and visible elsewhere.
const vues = etapes.map((etape) => etape.dalle);
assert.equal(Math.min(...vues), 0, 'the slab is never occluded: the Hi-Z test decides nothing');
assert.ok(Math.max(...vues) > 0, 'the slab is never visible: the Hi-Z test decides nothing');
console.log(
  `OK: ${etapes.length} rig poses, image identical to the witness moving and still — ${resultat.adaptateur}`,
);
