// Preuve par le moteur réel : à caméra mobile, quand les pages restent les mêmes, les bornes
// envoyées au test Hi-Z sont celles de la NOUVELLE caméra.
//
// Ces bornes sont des rectangles d'écran, tenus d'une image à l'autre avec les fiches de dessin. Le
// témoin est un second moteur, neuf à chaque pose, qui n'a rien à tenir : la pose atteinte en
// glissant et la même pose rendue d'emblée doivent donner la même image, octet pour octet. Un
// rectangle périmé rejetterait un cluster visible, et la dalle lointaine manquerait à l'image.
//
//   node --experimental-strip-types test/hizCameraGlissante.browser.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from './preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'hizGlissantePage.mjs',
  'hizGlissante',
  'Bornes projetées à caméra mobile',
);
console.log(
  JSON.stringify(
    { adaptateur: resultat.adaptateur ?? null, etapes: resultat.etapes, erreurs: resultat.erreurs },
    null,
    2,
  ),
);
preuveSaine(resultat);

const etapes = resultat.etapes;
assert.ok(etapes.length >= 4, 'la glissade doit compter plusieurs poses');
for (const etape of etapes) {
  assert.equal(
    etape.clusters,
    etapes[0].clusters,
    `la coupe a changé en ${etape.x} : la preuve exigeait des pages identiques`,
  );
  assert.ok(etape.testes !== null, `aucun test Hi-Z en ${etape.x} : la preuve porterait sur rien`);
  assert.equal(
    etape.ecart,
    0,
    `en ${etape.x}, l’image glissée et l’image neuve diffèrent sur ${etape.ecart} pixels : ` +
      'des rectangles d’écran d’une caméra précédente sont encore testés',
  );
}
// Sans bascule d'occultation le long de la glissade, l'égalité avec le témoin ne prouverait rien :
// la dalle lointaine doit être cachée quelque part et visible ailleurs.
const vus = etapes.map((etape) => etape.dalleTemoin);
assert.equal(Math.min(...vus), 0, 'la dalle n’est jamais occultée : le test Hi-Z ne tranche rien');
assert.ok(Math.max(...vus) > 0, 'la dalle n’est jamais visible : le test Hi-Z ne tranche rien');
console.log(
  `OK : ${etapes.length} poses glissées contre un moteur neuf, 0 pixel d’écart — ${resultat.adaptateur}`,
);
