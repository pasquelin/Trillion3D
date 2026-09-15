// C1 : le remplissage du visbuffer. La référence est `visibilityRaster.ts:15-64` recopié tel quel —
// deux divisions et quatre produits par pixel — et le candidat évalue les mêmes poids sous leur
// forme affine : une division par triangle, des pas constants par colonne et par ligne. Le candidat
// a été refusé et son commit reverté ; le banc le garde pour que la raison du refus reste
// reproductible. Un test vérifie que la référence recopiée est bien ce que le paquet rasterise
// aujourd'hui, sinon la comparaison ne dirait plus rien.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterVisibility } from '../visibilityRaster.ts';
import { fillAffine, fillReference, rasterAvec } from './rasterC.mjs';
import { quadrillage } from './scenesC.mjs';
import { compareC, deposeC } from './bancC.mjs';
import { compteur, note, ulpEntre } from './ecartsC.mjs';
import { camera, coupe } from './scenes.mjs';

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

const cam = camera(6, 0.1, 16 / 9);
const image = [1280, 720];
const carre = camera(3, 0.1, 1);
const grande = { pages: coupe({ pages: 400, triangles: 24, hostile: true, seed: 7 }), cam, image };
const rase = {
  pages: coupe({ pages: 24, triangles: 24, hostile: true, seed: 23, taille: 2.2 }),
  cam,
  image,
};
const vide = { pages: [], cam, image };
const diagonale = { pages: quadrillage(1, 1), cam: carre, image: [64, 64] };
const damier = { pages: quadrillage(8, 0.25), cam: carre, image };
const autresGraines = [11, 37, 97].map((seed) => ({
  pages: coupe({ pages: 120, triangles: 24, hostile: true, seed, taille: 0.5 }),
  cam,
  image,
}));
const tour = (fn) => (entree) => fn(entree.pages, entree.cam, entree.image);

const lignes = [
  await compareC({
    calcul: 'C1 fillIds',
    fichier: 'packages/sdk-browser/visibilityRaster.ts',
    cas: [
      { nom: '1280×720, 9 600 triangles dont dégénérés', entree: grande, taille: 9600 },
      { nom: '1280×720, triangles rasants et derrière la caméra', entree: rase, taille: 576 },
      { nom: 'aucune page', entree: vide, taille: 0 },
      { nom: '64×64, diagonale partagée au centre du pixel', entree: diagonale, taille: 2 },
      { nom: '1280×720, 64 quadrilatères en damier', entree: damier, taille: 128 },
      ...autresGraines.map((entree, i) => ({
        nom: `graine ${[11, 37, 97][i]}, 2 880 triangles`,
        entree,
        taille: 2880,
        mesure: false,
      })),
    ],
    reference: tour(rasterAvec(fillReference)),
    optimisee: tour(rasterAvec(fillAffine)),
    differences: differencesImage,
    // Identifiants intacts et profondeurs à un ULP près : c'est la seule tolérance du lot.
    tolere: (c) => c.pixelsId === 0 && c.ulpMax <= 1,
    options: { chauffe: 2, tours: 12, budgetMs: 3000 },
  }),
];

test('la référence recopiée est bien ce que le paquet rasterise aujourd’hui', () => {
  const copie = tour(rasterAvec(fillReference));
  for (const entree of [grande, rase, diagonale, damier, ...autresGraines]) {
    const attendu = tour(rasterVisibility)(entree),
      obtenu = copie(entree);
    assert.deepEqual(obtenu.ids, attendu.ids);
    assert.deepEqual(obtenu.depth, attendu.depth);
  }
});
test('C1 a été mesuré et son écart est décrit', () => {
  for (const ligne of lignes) {
    assert.ok(ligne.avantMs > 0, `${ligne.calcul} : aucune mesure`);
    assert.ok(ligne.identique || ligne.ecart, `${ligne.calcul} : écart non décrit`);
  }
});
deposeC('raster-c', lignes);
