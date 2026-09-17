// Preuve par le moteur réel : la même caméra physique (near 2,8, far 12), un carreau incliné qui
// traverse le plan proche, rendue alors que l'hôte bascule sa convention de découpe — `[−1, 1]`
// côté WebGL, `[0, 1]` côté WebGPU — donne la même image au pixel près, dans les deux sens.
// Depuis le lot « Z inversé », le moteur ne lit plus cette convention : il compose sa propre
// projection, en profondeur inversée et plan lointain infini. Le basculement ne change donc AUCUN
// nombre du moteur, et l'image tenue doit le rester — c'est ce que ce test vérifie.
//
//   LAB_ROOT=… node --experimental-strip-types test/browser/convention-profondeur-moteur-complet.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'depthConventionMoteurCompletPage.mjs',
  'depthConventionMoteurComplet',
  'Convention de profondeur',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, passes: resultat.passes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

for (const [passe, r] of Object.entries(resultat.passes)) {
  const dit = (message) => `${passe} : ${message}`;
  assert.ok(r.rougeWebgl > 0, dit('le carreau incliné n’est pas visible en convention WebGL'));
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('webgl-') && e.tenue),
    dit('l’image WebGL ne s’est jamais tenue'),
  );
  assert.equal(
    r.etapes.find((e) => e.nom === 'webgpu-0').tenue,
    true,
    dit('le passage en WebGPU a fait recalculer une image que rien ne change'),
  );
  assert.equal(r.versWebgpu, 0, dit('la convention WebGPU dessine autre chose que WebGL'));
  assert.equal(
    r.etapes.find((e) => e.nom === 'retour-0').tenue,
    true,
    dit('le retour en WebGL a fait recalculer une image que rien ne change'),
  );
  assert.equal(r.versRetour, 0, dit('le retour en WebGL ne redonne pas la même image'));
}
console.log(
  `OK : 2 passes (paginée, non paginée) × ${Object.values(resultat.passes)[0].etapes.length} images ` +
    `du moteur WebGPU réel — ${resultat.adaptateur}`,
);
