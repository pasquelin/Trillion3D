// A1 et A5 : la profondeur du visbuffer et le choix du niveau de mip.
// Référence = le code d'avant, recopié tel quel dans `oracles/hiz.mjs` ; optimisée = celle du paquet.
import { hizTestRect } from '../../../packages/sdk-browser/hizOcclusion.ts';
import { visibilityDepth } from '../../../packages/sdk-browser/hizDepth.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import { compare, verifieEtDepose } from './banc.mjs';
import { camera, coupe, rectangles } from './scenes.mjs';
import { referenceHizTestRect, referenceVisibilityDepth } from './oracles/hiz.mjs';

const image = (largeur, hauteur, pages) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  return { ids: rasterVisibility(pages, cam, viewport).ids, pages, cam, viewport };
};
const pages = coupe({ pages: 900, triangles: 48 });
const profondeur = [
  { nom: '320×180, 43 200 triangles', entree: image(320, 180, pages), taille: 320 * 180 },
  {
    nom: '1280×720, 43 200 triangles',
    entree: image(1280, 720, pages),
    taille: 1280 * 720,
    mesure: false,
  },
  { nom: 'aucune page', entree: image(64, 36, []), taille: 64 * 36 },
  { nom: 'une page', entree: image(64, 36, pages.slice(0, 1)), taille: 64 * 36 },
];

const rects = rectangles({ count: 20000 });
const scratchReference = new Int32Array(5),
  scratchOptimisee = new Int32Array(5);
const parcours = (testRect, scratch) => (rectangles_) => {
  const sortie = new Int32Array(rectangles_.length * 6);
  for (let i = 0; i < rectangles_.length; i++) {
    const [x0, y0, x1, y1, clipsNear] = rectangles_[i];
    sortie[i * 6] = testRect(x0, y0, x1, y1, clipsNear, 1280, 720, 12, scratch) ? 1 : 0;
    for (let v = 0; v < 5; v++) sortie[i * 6 + 1 + v] = scratch[v];
  }
  return sortie;
};

const lignes = [
  await compare({
    calcul: 'A1 visibilityDepth',
    fichier: 'packages/sdk-browser/hizDepth.ts',
    cas: profondeur,
    reference: ({ ids, pages: p, cam, viewport }) =>
      referenceVisibilityDepth(ids, p, cam, viewport),
    optimisee: ({ ids, pages: p, cam, viewport }) => visibilityDepth(ids, p, cam, viewport),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A5 hizTestRect',
    fichier: 'packages/sdk-browser/hizOcclusion.ts',
    cas: [
      { nom: '20003 rectangles, 12 niveaux', entree: rects, taille: rects.length },
      { nom: 'aucun rectangle', entree: [], taille: 0 },
    ],
    reference: parcours(referenceHizTestRect, scratchReference),
    optimisee: parcours(hizTestRect, scratchOptimisee),
    options: { tours: 200, budgetMs: 2000 },
  }),
];

verifieEtDepose('hiz', 'A1 et A5 rendent exactement les mêmes valeurs', lignes);
