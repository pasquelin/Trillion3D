// Preuve par le moteur réel : la même caméra physique (near 2,8, far 12), un carreau incliné qui
// traverse le plan proche, rendue sous les deux conventions de profondeur de découpe — `[−1, 1]`
// côté WebGL, `[0, 1]` côté WebGPU — donne la même image au pixel près, dans les deux sens.
// `depthConvention.ts` est le seul site qui convertit ; `readCameraWorld` est le seul qui décide de
// la convention à lire sur `camera.coordinateSystem`. Un changement de convention doit casser la
// tenue de l'image tenue — sans quoi la première image sous la nouvelle convention resterait celle
// de l'ancienne, jamais recalculée.
//
//   LAB_ROOT=… node --experimental-strip-types test/depthConventionMoteurComplet.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from './preuvePageMoteur.mjs';

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
    false,
    dit('la première image après le passage en WebGPU est restée tenue'),
  );
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('webgpu-') && e.tenue),
    dit('l’image WebGPU ne s’est jamais restabilisée'),
  );
  assert.equal(r.versWebgpu, 0, dit('la convention WebGPU dessine autre chose que WebGL'));
  assert.equal(
    r.etapes.find((e) => e.nom === 'retour-0').tenue,
    false,
    dit('la première image après le retour en WebGL est restée tenue'),
  );
  assert.ok(
    r.etapes.some((e) => e.nom.startsWith('retour-') && e.tenue),
    dit('l’image de retour ne s’est jamais restabilisée'),
  );
  assert.equal(r.versRetour, 0, dit('le retour en WebGL ne redonne pas la même image'));
}
console.log(
  `OK : 2 passes (paginée, non paginée) × ${Object.values(resultat.passes)[0].etapes.length} images ` +
    `du moteur WebGPU réel — ${resultat.adaptateur}`,
);
