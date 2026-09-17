// Banc de performance : écriture et compactage CPU des fiches de dessin (draw item words).
import { DRAW_ITEM_U32 } from '../gpuDraw.ts';
import { createDrawItemWordsHold, refreshDrawItemWords } from '../webgpuVisibilityItemWords.ts';
import { mesure, rapport } from '../../sdk-core/bench/mesure.mjs';

function creeRuntime(n, drawLayerSlots) {
  const packedRecs = [];
  const material = { side: 0 };
  const matrix = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  for (let i = 0; i < n; i++) packedRecs.push({ depthLayer: i % 3, material, matrix });
  const layout = {
    rows: {
      packedCount: n,
      packedRecs,
      packedPageIndex: Int32Array.from({ length: n }, (_, i) => 100 + i),
      dirtyFrom: 0,
      dirtyTo: n - 1,
    },
    drawItemWords: new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    itemWordsHold: createDrawItemWordsHold(),
  };
  const rt = { layout, vis: { drawLayerSlots } };
  return { rt, n };
}

const cas1000 = creeRuntime(1000, 3);
const cas10000 = creeRuntime(10000, 3);
const cas50000 = creeRuntime(50000, 3);

function executeEcriture({ rt, n }) {
  rt.layout.rows.dirtyFrom = 0;
  rt.layout.rows.dirtyTo = n - 1;
  const hold = refreshDrawItemWords(rt, 2, {});
  return hold.to - hold.from + 1;
}

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureMots = await mesure({
  nom: 'écriture mots de dessin',
  fichier: 'packages/sdk-browser/webgpuVisibilityItemWords.ts',
  cas: [
    { nom: '1 000 lignes de dessin', entree: cas1000, taille: 1000 },
    { nom: '10 000 lignes de dessin', entree: cas10000, taille: 10000 },
    { nom: '50 000 lignes de dessin', entree: cas50000, taille: 50000 },
  ],
  calcul: executeEcriture,
  attendu: ({ n }) => n,
  options,
});

rapport(
  'mots-dessin',
  mesureMots,
  'les mots de dessin sont écrits pour chaque ligne de la plage sale',
);
