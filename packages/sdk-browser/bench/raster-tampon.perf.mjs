// le remplissage du visbuffer. La référence est `visibilityRaster.ts` recopié tel quel — deux
// divisions et quatre produits par pixel — et le candidat évalue les mêmes poids sous leur forme
// affine : une division par triangle, des pas constants par colonne et par ligne. Le candidat a été
// refusé et son commit reverté ; le banc le garde pour que la raison du refus reste reproductible.
// Un test vérifie que la référence recopiée est bien ce que le paquet rasterise aujourd'hui, sinon
// la comparaison ne dirait plus rien.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterVisibility } from '../visibilityRaster.ts';
import { fillAffine, fillReference, rasterAvec } from './appui/rasterTampon.mjs';
import { quadrillage } from './appui/scenesCoupe.mjs';
import { compteur, ecart, mesure, note, rapport, stress } from '../../sdk-core/bench/socle.mjs';
import { camera, coupe } from './appui/scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

/** L'écart d'une image : combien de pixels changent d'identifiant, combien changent de profondeur. */
function differencesImage(attendu, obtenu, nom) {
  const c = compteur();
  for (let i = 0; i < attendu.ids.length; i++) {
    if (attendu.ids[i] !== obtenu.ids[i]) {
      c.nombre++;
      c.premier ??= `${nom} identifiant [${i}]: ${attendu.ids[i]} ≠ ${obtenu.ids[i]}`;
    }
    // Un identifiant est un entier : seule la profondeur a un écart qui se compte en ULP.
    note(c, attendu.depth[i], obtenu.depth[i], `${nom} profondeur [${i}]`, 32);
  }
  return c;
}

// La caméra hôte du décor, et celle du moteur qui en découle : posées une fois, jamais par tour.
const hote = camera(6, 0.1, 16 / 9),
  hoteCarre = camera(3, 0.1, 1);
const cam = cameraMoteur(hote);
const image = [1280, 720];
const carre = cameraMoteur(hoteCarre);
const grande = { pages: coupe({ pages: 400, triangles: 24, hostile: true, seed: 7 }), cam, image };
const rase = {
  pages: coupe({ pages: 24, triangles: 24, hostile: true, seed: 23, taille: 2.2 }),
  cam,
  image,
};
const vide = { pages: [], cam, image };
const diagonale = { pages: quadrillage(1, 1), cam: carre, image: [64, 64] };
const damier = { pages: quadrillage(8, 0.25), cam: carre, image };
const GRAINES = [11, 37, 97];
const autresGraines = GRAINES.map((seed) => ({
  pages: coupe({ pages: 120, triangles: 24, hostile: true, seed, taille: 0.5 }),
  cam,
  image,
}));

const tour = (fn) => (entree) => fn(entree.pages, entree.cam, entree.image);

const resC1 = await mesure({
  nom: 'visbuffer candidat affine contre perspective',
  fichier: 'packages/sdk-browser/visibilityRaster.ts',
  cas: [
    { nom: '1280×720, 9 600 triangles dont dégénérés', entree: grande, taille: 9600 },
    { nom: '1280×720, triangles rasants et derrière la caméra', entree: rase, taille: 576 },
    { nom: 'aucune page', entree: vide, taille: 0 },
    { nom: '64×64, diagonale partagée au centre du pixel', entree: diagonale, taille: 2 },
    { nom: '1280×720, 64 quadrilatères en damier', entree: damier, taille: 128 },
    ...autresGraines.map((entree, i) => ({
      nom: `graine ${GRAINES[i]}, 2 880 triangles`,
      entree,
      taille: 2880,
      mesure: false,
    })),
  ],
  calcul: tour(rasterAvec(fillAffine)),
  attendu: tour(rasterAvec(fillReference)),
  // Le candidat a été refusé : donner un comparateur d'écarts dit au socle de chiffrer ce qu'il
  // déplace au lieu de réclamer une égalité qui n'a pas lieu d'être.
  differences: differencesImage,
  options: { chauffe: 2, tours: 12, budgetMs: 3000 },
});

// `ecart` compare les deux tampons valeur par valeur et nomme le premier pixel fautif ; c'est
// `deepEqual`, sur un million de pixels, qui coûtait trop cher.
test('la référence recopiée est bien ce que le paquet rasterise aujourd’hui', () => {
  const copie = tour(rasterAvec(fillReference));
  const entrees = [grande, rase, diagonale, damier, ...autresGraines];
  for (let i = 0; i < entrees.length; i++)
    assert.equal(ecart(tour(rasterVisibility)(entrees[i]), copie(entrees[i]), `image ${i}`), null);
});

await stress({
  nom: 'rasterVisibility extremes',
  calcul: (e) => rasterVisibility(e.pages, e.cam, e.image),
  extremes: [{ nom: 'vide', entree: vide }],
});

rapport('raster-tampon', [resC1], 'C1 a été mesuré et son écart à la référence est chiffré');
