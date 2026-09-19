// Proof by the real engine: a transparent object moved by the public `setTransform` API changes
// place in the image, paged as unpaged, by its own node as by its parent, under a sheared
// matrix, out of view and on return, including after the held image has stabilised.
//
// The page (`test/appui/transparentTransformPage.mjs`) is bundled by esbuild and run in Chromium
// with a real WebGPU device. Nothing is simulated: `webgpuPagesBackend`, its passes and its image readout.
//
//   node --experimental-strip-types test/browser/transparent-transform.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'transparentTransformPage.mjs',
  'transparentTransform',
  'Moved transparent',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, passes: resultat.passes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

/** The page's three probes: left, right, top-right corner of the sheared tile. */
const [GAUCHE, DROITE, COIN] = [0, 1, 2];

for (const [passe, etapes] of Object.entries(resultat.passes)) {
  const de = (nom) =>
    etapes.find((e) => (e.name ?? e.nom) === nom) ?? assert.fail(`${passe}: ${nom} missing`);
  const dit = (nom, message) => `${passe} / ${nom}: ${message}`;
  const gauche = de('gauche');
  assert.ok(gauche.rouge[GAUCHE], dit('gauche', 'the transparent is not on the left'));
  assert.ok(!gauche.rouge[DROITE], dit('gauche', 'the transparent is also on the right'));
  const droite = de('droite');
  assert.ok(droite.rouge[DROITE], dit('droite', 'setTransform did not move the transparent'));
  assert.ok(!droite.rouge[GAUCHE], dit('droite', 'the transparent stayed on the left'));
  const parent = de('parent-gauche');
  assert.ok(parent.rouge[GAUCHE], dit('parent-gauche', 'the parent does not carry its child'));
  assert.ok(!parent.rouge[DROITE], dit('parent-gauche', 'the child stayed on the right'));
  const cisaille = de('cisaille');
  assert.ok(cisaille.rouge[COIN], dit('cisaille', 'shear is lost at draw'));
  const hors = de('hors-champ');
  assert.ok(
    !hors.rouge[GAUCHE] && !hors.rouge[DROITE],
    dit('hors-champ', 'the transparent stayed visible'),
  );
  assert.equal(hors.dessins, 0, dit('hors-champ', 'draws were issued for it'));
  assert.ok(hors.rejetes >= 1, dit('hors-champ', 'the frustum did not reject it'));
  const retour = de('retour');
  assert.ok(retour.rouge[GAUCHE], dit('retour', 'the transparent did not come back'));
  assert.ok(retour.dessins >= 1, dit('retour', 'no return draw'));
  const stables = etapes.filter((e) => (e.name ?? e.nom).startsWith('stabilisation-'));
  assert.ok(
    stables.some((e) => e.tenue),
    dit('stabilisation', 'the image was never held: the after-hold proof would be empty'),
  );
  const apres = de('apres-tenue');
  assert.equal(apres.tenue, false, dit('apres-tenue', 'hold was not broken'));
  assert.ok(apres.rouge[DROITE], dit('apres-tenue', 'the new location is not shown'));
  assert.ok(!apres.rouge[GAUCHE], dit('apres-tenue', 'the old location is still painted'));
}
console.log(
  `OK: 2 passes (paged, unpaged) × 13 frames of the real WebGPU engine — ${resultat.adaptateur}`,
);
