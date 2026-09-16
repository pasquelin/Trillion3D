// Preuve par le moteur réel : un rig d'hôte déplacé, scène immobile, coupe inchangée — les bornes
// PROJETÉES envoyées au test Hi-Z sont celles de la nouvelle vue, et une vue immobile ne les refait
// pas.
//
// Ces bornes sont des rectangles d'écran, tenus d'une image à l'autre derrière une empreinte de vue.
// Sous un rig, la caméra n'a pas de pose locale nouvelle : sans résolution de la chaîne d'ancêtres,
// l'empreinte ne voit rien bouger et le cache est tenu à tort. Les deux moitiés de la preuve :
//   (a) le rig bouge → des rectangles sont réécrits, et l'image est celle d'un moteur neuf placé
//       d'emblée à la même pose monde, octet pour octet ;
//   (b) plus rien ne bouge → aucun rectangle n'est réécrit, donc le cache est bien tenu et la
//       correction n'a pas été obtenue en supprimant l'optimisation.
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
// (a) Le rig déplacé retire les rectangles tenus. La première pose est à zéro : le rig n'a pas
// encore bougé et l'image de départ les a déjà posés.
for (const etape of etapes.slice(1))
  assert.ok(
    etape.projetesApresDeplacement > 0,
    `en ${etape.x}, le rig a bougé et aucun rectangle n’a été réécrit : ` +
      'la pose de la caméra n’a pas été résolue avant l’empreinte de vue',
  );
// (b) Rien ne bouge : le cache tient. Une image tenue n'encode rien et ne compte rien — elle ne
// prouverait pas la tenue du cache, elle la contournerait.
for (const etape of etapes) {
  assert.equal(etape.tenueImmobile, false, `en ${etape.x}, l’image immobile a été tenue`);
  assert.equal(
    etape.projetesImmobile,
    0,
    `en ${etape.x}, une vue immobile a réécrit ${etape.projetesImmobile} rectangles : ` +
      'le cache ne tient plus rien',
  );
}
// Sans bascule d'occultation le long des poses, l'égalité avec le témoin ne prouverait rien : la
// dalle lointaine doit être occultée quelque part et visible ailleurs.
const vues = etapes.map((etape) => etape.dalle);
assert.equal(Math.min(...vues), 0, 'la dalle n’est jamais occultée : le test Hi-Z ne tranche rien');
assert.ok(Math.max(...vues) > 0, 'la dalle n’est jamais visible : le test Hi-Z ne tranche rien');
console.log(
  `OK : ${etapes.length} poses de rig, rectangles refaits au déplacement et tenus à l’arrêt — ${resultat.adaptateur}`,
);
