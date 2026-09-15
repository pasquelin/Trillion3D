// G11 : la géométrie d'une entrée de preview. Ses trois nombres se déduisent des deux mêmes bornes,
// et chacun repartait pourtant des dimensions source, `previewFirstLevel` compris.
import { previewGeometry } from '../texturePreviewLevels.ts';
import { compare } from './banc.mjs';
import { verifieEtDeposeG } from './bancG.mjs';
import { referenceExpectedGeometry } from './oracles/g-preview.mjs';

/** Dimensions source d'une entrée de preview : limites, côtés dégénérés, tailles courantes. */
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

const lignes = [
  await compare({
    calcul: 'G11 géométrie d’une entrée de preview',
    fichier: 'packages/sdk-core/texturePreviewLevels.ts, manifestBinaryPreview.ts',
    cas: [
      { nom: '4 000 entrées, huit tailles limites', entree: entrees, taille: 4000 },
      { nom: 'une entrée 1×1', entree: [[1, 1]], taille: 1 },
      { nom: 'une entrée de côté maximal', entree: [[0xffffffff, 0xffffffff]], taille: 1 },
      { nom: 'aucune entrée', entree: [], taille: 0 },
    ],
    reference: geometries(referenceExpectedGeometry),
    optimisee: geometries(previewGeometry),
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDeposeG('g-preview', 'G11 rend la même géométrie d’entrée, au bit près', lignes);
