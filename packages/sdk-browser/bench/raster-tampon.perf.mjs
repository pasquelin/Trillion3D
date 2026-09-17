// C1 : remplissage du visbuffer, affine vs perspective.
import { rasterVisibility } from '../visibilityRaster.ts';
import { fillAffine, fillReference, rasterAvec } from './rasterTampon.mjs';
import { quadrillage } from './scenesCoupe.mjs';
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera, coupe } from './scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

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

const tour = (fn) => (entree) => fn(entree.pages, entree.cam, entree.image);

const resC1 = await mesure({
  nom: 'C1 visbuffer candidat affine contre perspective',
  fichier: 'packages/sdk-browser/visibilityRaster.ts',
  cas: [
    { nom: '1280×720, 9 600 triangles', entree: grande, taille: 9600 },
    { nom: '1280×720, vue rasante', entree: rase, taille: 576 },
    { nom: 'aucune page', entree: vide, taille: 0 },
    { nom: '64×64, diagonale', entree: diagonale, taille: 2 },
    { nom: '1280×720, damier 8×8', entree: damier, taille: 128 },
  ],
  calcul: tour(rasterAvec(fillAffine)),
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

await stress({
  nom: 'rasterVisibility extremes',
  calcul: (e) => rasterVisibility(e.pages, e.cam, e.image),
  extremes: [{ nom: 'vide', entree: vide }],
});

rapport('raster-c', [resC1], 'C1 a été mesuré et son refus est motivé');
