// Preuve par le moteur réel : un rig d'hôte déplacé, scène immobile, coupe inchangée — les bornes
// PROJETÉES envoyées au test Hi-Z sont celles de la nouvelle vue.
//
// Ces bornes sont des rectangles d'écran, que la partition GPU calcule par image depuis les matrices
// de vue que le processeur lui envoie. Sous un rig, la caméra n'a pas de pose locale nouvelle : sans
// résolution de la chaîne d'ancêtres, ces matrices seraient celles de la vue précédente et le test
// Hi-Z trancherait sur les rectangles d'une autre vue. Les deux moitiés de la preuve :
//   (a) le rig bouge → l'image est celle d'un moteur neuf placé d'emblée à la même pose monde,
//       octet pour octet ;
//   (b) l'image qui suit, immobile, l'est encore — et elle n'a pas été tenue, donc elle a bien été
//       dessinée depuis les mêmes matrices plutôt que recopiée.
//
//   node --experimental-strip-types test/hizCameraRig.browser.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from './preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage('hizRigPage.mjs', 'hizRig', 'Rig d’hôte déplacé');
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, etapes: resultat.etapes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const etapes = resultat.etapes;
assert.ok(etapes.length >= 4, 'la preuve doit compter plusieurs poses de rig');
for (const etape of etapes) {
  assert.equal(
    etape.clusters,
    etapes[0].clusters,
    `la coupe a changé en ${etape.x} : la preuve exigeait des pages identiques`,
  );
  assert.equal(
    etape.ecart,
    0,
    `en ${etape.x}, l’image du rig et celle du moteur neuf diffèrent sur ${etape.ecart} pixels : ` +
      'des rectangles d’écran d’une vue précédente sont encore testés',
  );
}
// (a) et (b) : la partition traite toutes les lignes dessinables à chaque image, et les deux images
// de chaque pose valent celle du témoin. Une image tenue n'encode rien et ne compte rien — elle ne
// prouverait pas la résolution du rig, elle la contournerait.
for (const etape of etapes) {
  assert.ok(
    etape.lignesApresDeplacement > 0 && etape.lignesImmobile === etape.lignesApresDeplacement,
    `en ${etape.x}, la partition n’a pas traité les mêmes lignes aux deux images`,
  );
  assert.equal(etape.tenueImmobile, false, `en ${etape.x}, l’image immobile a été tenue`);
  assert.equal(
    etape.ecartImmobile,
    0,
    `en ${etape.x}, l’image immobile diffère du témoin sur ${etape.ecartImmobile} pixels : ` +
      'des matrices d’une vue précédente sont encore projetées',
  );
}
// Sans bascule d'occultation le long des poses, l'égalité avec le témoin ne prouverait rien : la
// dalle lointaine doit être occultée quelque part et visible ailleurs.
const vues = etapes.map((etape) => etape.dalle);
assert.equal(Math.min(...vues), 0, 'la dalle n’est jamais occultée : le test Hi-Z ne tranche rien');
assert.ok(Math.max(...vues) > 0, 'la dalle n’est jamais visible : le test Hi-Z ne tranche rien');
console.log(
  `OK : ${etapes.length} poses de rig, image identique au témoin en mouvement et à l’arrêt — ${resultat.adaptateur}`,
);
