// Banc de performance : calcul d'empreinte écran et dérivation des priorités de texture.
import { createTextureDemand } from '../textureDemand.ts';
import { createTextureMeasure } from '../texturePriorityMeasure.ts';
import { graine, mesure, rapport } from '../../sdk-core/bench/mesure.mjs';

function creeSurfacesTexturees(nbSurfaces) {
  const alea = graine(999);
  const nbMats = 20;
  const materiaux = Array.from({ length: nbMats }, (_, i) => ({ id: i }));
  const index = new Map(
    materiaux.map((m, i) => [m, { color: [i * 2], data: [i * 2 + 1] }]),
  );
  const matrices = [
    { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1] },
    { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, -20, 1] },
  ];
  const requested = [];
  for (let i = 0; i < nbSurfaces; i++) {
    const r = 0.2 + alea() * 2;
    const cx = (alea() - 0.5) * 50;
    const cy = (alea() - 0.5) * 50;
    const cz = -alea() * 80;
    requested.push({
      matrix: matrices[i % 2],
      material: materiaux[i % nbMats],
      keyIndex: i,
      min: [cx - r, cy - r, cz - r],
      max: [cx + r, cy + r, cz + r],
      attributes: null,
    });
  }
  const cam = {
    view: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    projection: new Float64Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0]),
    near: 0.1,
  };
  const texels = new Float64Array(nbMats * 2).fill(1024);
  return { index, requested, cam, texels, keyCount: nbSurfaces };
}

const surfaces500 = creeSurfacesTexturees(500);
const surfaces2000 = creeSurfacesTexturees(2000);
const surfaces10000 = creeSurfacesTexturees(10000);

function executeMesurePriorite({ index, requested, cam, texels, keyCount }) {
  const color = createTextureDemand();
  const data = createTextureDemand();
  const evaluateur = createTextureMeasure(color, data);
  evaluateur({
    index,
    requested,
    blend: [],
    cam,
    viewport: [0, 0, 1920, 1080],
    colorTexels: texels,
    dataTexels: texels,
    keyCount,
  });
  return color.counters.visible;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesurePriorite = await mesure({
  nom: 'priorité de texture par empreinte écran',
  fichier: 'packages/sdk-browser/texturePriorityMeasure.ts',
  cas: [
    { nom: '500 surfaces texturées', entree: surfaces500, taille: 500 },
    { nom: '2 000 surfaces texturées', entree: surfaces2000, taille: 2000 },
    { nom: '10 000 surfaces texturées', entree: surfaces10000, taille: 10000 },
  ],
  calcul: executeMesurePriorite,
  attendu: executeMesurePriorite,
  options,
});

rapport(
  'priorite-textures',
  mesurePriorite,
  'l’évaluation d’empreinte écran produit un compte stable de textures visibles',
);
