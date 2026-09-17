// G11 : la géométrie d'une entrée de preview.
import { previewGeometry } from '../texturePreviewLevels.ts';
import { mesure, stress, rapport } from './mesure.mjs';
import { referenceExpectedGeometry } from './oracles/preview-texture.mjs';

const DIMENSIONS = [
  [0, 0],
  [1, 1],
  [64, 64],
  [65, 1],
  [1, 8192],
  [4096, 2048],
  [0xffffffff, 1],
  [3, 7],
];
const entrees = [];
for (let i = 0; i < 4000; i++) entrees.push(DIMENSIONS[i % DIMENSIONS.length]);

const geometries = (calcul) => (liste) =>
  liste.map(([w, h]) => {
    const g = calcul(w, h);
    return [g.firstLevel, g.levelCount, g.pixelBytes];
  });

const cas = [
  { nom: '4 000 entrées, huit tailles limites', entree: entrees, taille: 4000 },
  { nom: 'une entrée 1×1', entree: [[1, 1]], taille: 1 },
  { nom: 'une entrée de côté maximal', entree: [[0xffffffff, 0xffffffff]], taille: 1 },
  { nom: 'aucune entrée', entree: [], taille: 0 },
];

const res = await mesure({
  nom: 'G11 géométrie preview',
  fichier: 'packages/sdk-core/texturePreviewLevels.ts',
  cas,
  calcul: geometries(previewGeometry),
  attendu: geometries(referenceExpectedGeometry),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'previewGeometry extremes',
  calcul: ([w, h]) => previewGeometry(w, h),
  extremes: [
    { nom: 'zero', entree: [0, 0] },
    { nom: 'max 32-bit', entree: [0xffffffff, 0xffffffff] },
    { nom: 'asymetrique', entree: [1, 1 << 16] },
  ],
});

rapport('g-preview', [res], 'G11 rend la même géométrie d’entrée, au bit près');
