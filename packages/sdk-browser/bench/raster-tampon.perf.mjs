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
import { compteur, mesure, note, rapport, stress, ulpEntre } from '../../sdk-core/bench/socle.mjs';
import { camera, coupe } from './appui/scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

/** L'écart d'une image : combien de pixels changent d'identifiant, combien changent de profondeur. */
function differencesImage(attendu, obtenu, nom) {
  const c = compteur();
  for (let i = 0; i < attendu.ids.length; i++) {
    if (attendu.ids[i] !== obtenu.ids[i]) {
      c.pixelsId++;
      c.nombre++;
      c.premier ??= `${nom} identifiant [${i}]: ${attendu.ids[i]} ≠ ${obtenu.ids[i]}`;
    }
    if (!Object.is(attendu.depth[i], obtenu.depth[i])) {
      c.pixelsProfondeur++;
      const avant = c.nombre;
      note(c, attendu.depth[i], obtenu.depth[i], `${nom} profondeur [${i}]`, 32);
      if (avant === c.nombre) c.nombre++;
      const u = ulpEntre(attendu.depth[i], obtenu.depth[i], 32);
      if (u > c.ulpMax) c.ulpMax = u;
    }
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
  differences: differencesImage,
  // Le candidat a été refusé : le banc ne réclame pas son égalité, il chiffre ce qu'il déplace.
  ecartPublie: true,
  options: { chauffe: 2, tours: 12, budgetMs: 3000 },
});

test('chaque cas de C1 publie son écart chiffré', () => {
  for (const r of resC1.resultats) assert.ok(r.motif, `${r.nom} : écart non chiffré`);
});

/** Deux images identiques, valeur par valeur : `deepEqual` sur un million de pixels coûte trop. */
function memeImage(attendu, obtenu, nom) {
  assert.equal(obtenu.ids.length, attendu.ids.length, `${nom} : longueur`);
  for (let i = 0; i < attendu.ids.length; i++) {
    if (attendu.ids[i] !== obtenu.ids[i]) assert.fail(`${nom} : identifiant [${i}]`);
    if (!Object.is(attendu.depth[i], obtenu.depth[i])) assert.fail(`${nom} : profondeur [${i}]`);
  }
}

test('la référence recopiée est bien ce que le paquet rasterise aujourd’hui', () => {
  const copie = tour(rasterAvec(fillReference));
  const entrees = [grande, rase, diagonale, damier, ...autresGraines];
  for (let i = 0; i < entrees.length; i++)
    memeImage(tour(rasterVisibility)(entrees[i]), copie(entrees[i]), `image ${i}`);
});

await stress({
  nom: 'rasterVisibility extremes',
  calcul: (e) => rasterVisibility(e.pages, e.cam, e.image),
  extremes: [{ nom: 'vide', entree: vide }],
});

rapport('raster-tampon', [resC1], 'C1 a été mesuré et son écart à la référence est chiffré');
