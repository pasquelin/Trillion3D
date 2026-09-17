// Lot « pompe de textures » (a) : la note que l'ordre des textures tient sur chaque couche d'atlas.
//
// Avant le lot, la mesure d'une image reconstruisait tout par page : sphère de la boîte, couches du
// matériau par hachage, étendue uv par table faible. Après, ces trois-là sont bâtis à la première vue
// d'une GRAPPE et tenus tant que l'index des matériaux est le même ; ne reste par page que la
// projection. Douze placements d'une grappe partagent donc une ligne, comme au lot 5.
//
// Chaque tour est une IMAGE complète du chemin mesuré, la caméra avançant d'une image à l'autre : ce
// qui est chronométré est l'étape que la pompe paie, et l'égalité prouvée est celle du VERDICT —
// niveau voulu et poids de chaque couche, couleur et données, au bit près.
import { createTextureDemand } from '../textureDemand.ts';
import { createTextureMeasure } from '../texturePriorityMeasure.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { createReferenceMeasure, releve } from './oracles/pompe-textures.mjs';

const alea = graine(4127);
/** L'ordre de grandeur de la scène : une grappe unique posée douze fois, comme le catalogue réel. */
const PLACEMENTS = 12,
  MATERIAUX = 40,
  COUCHES = 2 * MATERIAUX + 2;

const matrices = Array.from({ length: PLACEMENTS }, (_, i) => {
  const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i * 40 - 220, 0, 0, 1];
  return { elements };
});
const materiaux = Array.from({ length: MATERIAUX }, (_, i) => ({ nom: `m${i}` }));
const index = new Map(
  materiaux.map((material, i) => [material, { color: [1 + i * 2], data: [2 + i * 2] }]),
);
// Une seule géométrie partagée : son étendue uv est mesurée une fois pour toute la scène, des deux
// côtés, et la mesure ne pèse donc sur aucun des deux chronomètres.
const attributes = { uv: { array: new Float32Array(1024), itemSize: 2, count: 512 } };

/** Une coupe de `pages` placements tirés de `pages / 12` grappes distinctes. */
function coupe(pages) {
  const grappes = Math.max(1, Math.round(pages / PLACEMENTS));
  const boites = [];
  for (let k = 0; k < grappes; k++) {
    const c = [alea() * 400 - 200, alea() * 100, alea() * 400 - 200],
      r = 0.5 + alea() * 3;
    boites.push({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] });
  }
  // Le catalogue range les pages PAR PRIMITIVE (`webgpuPagesLayout.ts`) et la sélection en garde
  // l'ordre : la coupe du banc est donc groupée par placement, et non entrelacée.
  const requested = [];
  for (let i = 0; i < pages; i++) {
    const k = i % grappes;
    requested.push({
      matrix: matrices[Math.floor((i * PLACEMENTS) / pages)],
      material: materiaux[k % MATERIAUX],
      attributes,
      keyIndex: k,
      min: boites[k].min,
      max: boites[k].max,
    });
  }
  return { requested, keyCount: grappes };
}

const texels = new Float64Array(COUCHES).fill(2048);
const camera = () => ({
  view: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, -30, 1]),
  projection: Float64Array.from([1.8, 0, 0, 0, 0, 2.4, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]),
  near: 0.1,
});

/** Huit images d'une caméra qui avance : la note est refaite à chaque image, des deux côtés. */
const IMAGES = 8;
const chemin = (mesure, cam, entree) => {
  const { requested, keyCount } = entree;
  for (let image = 0; image < IMAGES; image++) {
    cam.view[14] = -30 + image * 0.4;
    mesure({
      index,
      requested,
      blend: [],
      cam,
      viewport: [2560, 1440],
      colorTexels: texels,
      dataTexels: texels,
      keyCount,
    });
  }
};

// L'état des deux côtés vit d'un tour au suivant, comme dans le moteur : la résidence publiée et
// l'hystérésis des niveaux sont des acquis d'image, pas des allocations de tour.
const couleurReference = createTextureDemand(),
  donneesReference = createTextureDemand(),
  couleurOptimisee = createTextureDemand(),
  donneesOptimisee = createTextureDemand();
const mesureReference = createReferenceMeasure(couleurReference, donneesReference),
  mesureOptimisee = createTextureMeasure(couleurOptimisee, donneesOptimisee);
const camReference = camera(),
  camOptimisee = camera();

const reference = (entree) => {
  chemin(mesureReference, camReference, entree);
  return releve(couleurReference, donneesReference, COUCHES);
};
const optimisee = (entree) => {
  chemin(mesureOptimisee, camOptimisee, entree);
  return releve(couleurOptimisee, donneesOptimisee, COUCHES);
};

const lignes = [];
for (const pages of [5000, 20000, 60000])
  lignes.push(
    await compare({
      calcul: `GEO-4a note des textures — coupe de ${pages} placements`,
      fichier: 'packages/sdk-browser/texturePriorityMeasure.ts',
      cas: [
        {
          nom: `${IMAGES} images de ${pages} placements`,
          entree: coupe(pages),
          taille: pages * IMAGES,
        },
      ],
      reference,
      optimisee,
      options: { tours: 40, budgetMs: 3000, alterne: true },
    }),
  );

verifieEtDepose(
  'pompe-textures',
  'GEO-4a : la note tenue par grappe rend le même niveau et le même poids sur chaque couche',
  lignes,
);
