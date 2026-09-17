// Mesure absolue du Hi-Z : profondeur visbuffer et test d'occlusion rectangle.
// Chaque cas donne son temps médian, p95, throughput et comparaison à la baseline.
import { hizTestRect } from '../hizOcclusion.ts';
import { visibilityDepth } from '../hizDepth.ts';
import { rasterVisibility } from '../visibilityRaster.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera, coupe, rectangles } from './scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const image = (largeur, hauteur, pages) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  return { ids: rasterVisibility(pages, cameraMoteur(cam), viewport).ids, pages, cam, viewport };
};
const pages = coupe({ pages: 900, triangles: 48 });

// ── Mesure visibilityDepth ───────────────────────────────────────────
const depthResult = await mesure({
  nom: 'visibilityDepth',
  fichier: 'packages/sdk-browser/hizDepth.ts',
  cas: [
    { nom: '320×180 900p', entree: image(320, 180, pages), taille: 320 * 180 },
    { nom: '64×36 aucune page', entree: image(64, 36, []), taille: 64 * 36 },
    { nom: '64×36 une page', entree: image(64, 36, pages.slice(0, 1)), taille: 64 * 36 },
  ],
  calcul: ({ ids, pages: p, cam, viewport }) =>
    visibilityDepth(ids, p, cameraMoteur(cam), viewport),
  options: { tours: 200, budgetMs: 1000 },
});

// ── Mesure hizTestRect ───────────────────────────────────────────────
const rects = rectangles({ count: 20000 });
const scratch = new Int32Array(5);
const parcours = (rectangles_) => {
  const sortie = new Int32Array(rectangles_.length * 6);
  for (let i = 0; i < rectangles_.length; i++) {
    const [x0, y0, x1, y1, clipsNear] = rectangles_[i];
    sortie[i * 6] = hizTestRect(x0, y0, x1, y1, clipsNear, 1280, 720, 12, scratch) ? 1 : 0;
    for (let v = 0; v < 5; v++) sortie[i * 6 + 1 + v] = scratch[v];
  }
  return sortie;
};

const hizResult = await mesure({
  nom: 'hizTestRect',
  fichier: 'packages/sdk-browser/hizOcclusion.ts',
  cas: [
    { nom: '20k rects 12 niveaux', entree: rects, taille: rects.length },
    { nom: 'aucun rectangle', entree: [], taille: 0 },
  ],
  calcul: parcours,
  options: { tours: 200, budgetMs: 1000 },
});

// ── Stress testing ───────────────────────────────────────────────────
await stress({
  nom: 'hizTestRect extremes',
  calcul: (e) => hizTestRect(e.x0, e.y0, e.x1, e.y1, e.clip, 1280, 720, 12, scratch),
  extremes: [
    { nom: 'rect vide', entree: { x0: 5, y0: 5, x1: 4, y1: 4, clip: false } },
    { nom: 'rect immense', entree: { x0: 0, y0: 0, x1: 1 << 20, y1: 1 << 20, clip: false } },
    { nom: 'rect négatif', entree: { x0: -1000, y0: -1000, x1: -999, y1: -999, clip: false } },
    { nom: 'rect zéro', entree: { x0: 0, y0: 0, x1: 0, y1: 0, clip: true } },
  ],
});

rapport('hiz', [depthResult, hizResult], 'Hi-Z : profondeur et occlusion — mesure absolue');
