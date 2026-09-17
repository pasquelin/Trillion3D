// GEO-4a : la note que l'ordre des textures tient sur chaque couche d'atlas.
import { createTextureDemand } from '../textureDemand.ts';
import { createTextureMeasure } from '../texturePriorityMeasure.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { createReferenceMeasure, releve } from './oracles/pompe-textures.mjs';

const alea = graine(4127);
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
const attributes = { uv: { array: new Float32Array(1024), itemSize: 2, count: 512 } };

function coupe(pages) {
  const grappes = Math.max(1, Math.round(pages / PLACEMENTS));
  const boites = [];
  for (let k = 0; k < grappes; k++) {
    const c = [alea() * 400 - 200, alea() * 100, alea() * 400 - 200],
      r = 0.5 + alea() * 3;
    boites.push({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] });
  }
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

const IMAGES = 8;
const chemin = (mesureFn, cam, entree) => {
  const { requested, keyCount } = entree;
  for (let image = 0; image < IMAGES; image++) {
    cam.view[14] = -30 + image * 0.4;
    mesureFn({
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

const resultats = [];
for (const pages of [5000, 20000]) {
  resultats.push(
    await mesure({
      nom: `note des textures ${pages} placements`,
      fichier: 'packages/sdk-browser/texturePriorityMeasure.ts',
      cas: [
        {
          nom: `${IMAGES} images de ${pages} placements`,
          entree: coupe(pages),
          taille: pages * IMAGES,
        },
      ],
      calcul: optimisee,
      attendu: reference,
      options: { tours: 20, budgetMs: 1500 },
    }),
  );
}

await stress({
  nom: 'createTextureDemand extremes',
  calcul: () => {
    const d = createTextureDemand();
    d.reset();
    d.settle(new Float64Array(0));
  },
  extremes: [{ nom: 'vide', entree: null }],
});

rapport(
  'pompe-textures',
  resultats,
  'GEO-4a : la note tenue par grappe rend le même niveau et le même poids sur chaque couche',
);
