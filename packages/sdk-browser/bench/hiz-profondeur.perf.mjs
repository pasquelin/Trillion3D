// Absolute Hi-Z measurement: visbuffer depth and rectangle occlusion test. No oracle here:
// these two computations have no prior implementation to confront; their correctness is held by
// `hizDepth.test.ts` and `hizOcclusion.test.ts`. Each line says so rather than staying silent.
import { hizTestRect } from '../hizOcclusion.ts';
import { visibilityDepth } from '../hizDepth.ts';
import { rasterVisibility } from '../visibilityRaster.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { camera, coupe, rectangles } from './appui/scenes.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const image = (largeur, hauteur, pages) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  return { ids: rasterVisibility(pages, cameraMoteur(cam), viewport).ids, pages, cam, viewport };
};
const pages = coupe({ pages: 900, triangles: 48 });

// ── Mesure visibilityDepth ───────────────────────────────────────────
const depthResult = await mesure({
  name: 'visibilityDepth',
  fichier: 'packages/sdk-browser/hizDepth.ts',
  cas: [
    { name: '320×180 900p', input: image(320, 180, pages), size: 320 * 180 },
    { name: '64×36 no pages', input: image(64, 36, []), size: 64 * 36 },
    { name: '64×36 one page', input: image(64, 36, pages.slice(0, 1)), size: 64 * 36 },
  ],
  calcul: ({ ids, pages: p, cam, viewport }) =>
    visibilityDepth(ids, p, cameraMoteur(cam), viewport),
  motif: 'time only — correctness in hizDepth.test.ts',
  options: { tours: 200, budgetMs: 1000 },
});

// ── Mesure hizTestRect ───────────────────────────────────────────────
const rects = rectangles({ count: 20000 });
const scratch = new Int32Array(5);
const parcours = (rectangles_) => {
  const output = new Int32Array(rectangles_.length * 6);
  for (let i = 0; i < rectangles_.length; i++) {
    const [x0, y0, x1, y1, clipsNear] = rectangles_[i];
    output[i * 6] = hizTestRect(x0, y0, x1, y1, clipsNear, 1280, 720, 12, scratch) ? 1 : 0;
    for (let v = 0; v < 5; v++) output[i * 6 + 1 + v] = scratch[v];
  }
  return output;
};

const hizResult = await mesure({
  name: 'hizTestRect',
  fichier: 'packages/sdk-browser/hizOcclusion.ts',
  cas: [
    { name: '20k rects 12 niveaux', input: rects, size: rects.length },
    { name: 'no rectangles', input: [], size: 0 },
  ],
  calcul: parcours,
  motif: 'time only — correctness in hizOcclusion.test.ts',
  options: { tours: 200, budgetMs: 1000 },
});

// ── Stress testing ───────────────────────────────────────────────────
await stress({
  name: 'hizTestRect extremes',
  calcul: (e) => hizTestRect(e.x0, e.y0, e.x1, e.y1, e.clip, 1280, 720, 12, scratch),
  extremes: [
    { name: 'empty rect', input: { x0: 5, y0: 5, x1: 4, y1: 4, clip: false } },
    { name: 'huge rect', input: { x0: 0, y0: 0, x1: 1 << 20, y1: 1 << 20, clip: false } },
    { name: 'negative rect', input: { x0: -1000, y0: -1000, x1: -999, y1: -999, clip: false } },
    { name: 'zero rect', input: { x0: 0, y0: 0, x1: 0, y1: 0, clip: true } },
  ],
});

rapport(
  'hiz-profondeur',
  [depthResult, hizResult],
  'Hi-Z: depth and occlusion — absolute measurement',
);
