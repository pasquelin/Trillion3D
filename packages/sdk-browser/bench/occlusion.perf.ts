// Sharing occluders and occlusion test of an entire cut.
import { createHizCounts } from '../hizCounts.ts';
import { countUnoccluded } from '../hizUnoccluded.ts';
import { splitOccludersInto } from '../hizSplit.ts';
import { buildHizPyramid } from '../hizDepth.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { boites, camera } from './appui/scenes.ts';
import { referenceCountUnoccluded, referenceSplitOccluders } from './oracles/occlusion.ts';
import { cameraMoteur } from '../cameraFixture.ts';
import type { SceneBox } from './appui/scenes.ts';

const LARGEUR = 640,
  HAUTEUR = 360;
const alea = graine(29),
  profondeur = new Float32Array(LARGEUR * HAUTEUR);
for (let i = 0; i < profondeur.length; i++) profondeur[i] = alea() * 0.4 + 0.5;
const pyramide = buildHizPyramid(profondeur, LARGEUR, HAUTEUR);
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport: [number, number] = [LARGEUR, HAUTEUR];
const grande: SceneBox[] = boites({ count: 20000 }),
  cas = (pages: SceneBox[], name: string) => ({ name, input: pages, size: pages.length });
const jeux = [
  cas(grande, '20 000 boxes including degenerate'),
  cas(grande.slice(0, 1), 'one box'),
  cas([], 'no box'),
  cas(
    grande.filter((_, i) => i % 311 === 0).slice(0, 64),
    'only near plane cuts',
  ),
];

const urls = (pages: SceneBox[]) => pages.map((page) => page.url);
const occluders: SceneBox[] = [],
  rest: SceneBox[] = [];

const resSplit = await mesure({
  name: 'splitOccluders',
  fichier: 'packages/sdk-browser/hizSplit.ts',
  cas: jeux,
  calcul: (pages) => {
    splitOccludersInto(pages, cameraMoteur(cam), viewport, occluders, rest);
    return { occluders: urls(occluders), rest: urls(rest) };
  },
  attendu: (pages) => {
    const split = referenceSplitOccluders(pages, cam, viewport);
    return { occluders: urls(split.occluders), rest: urls(split.rest) };
  },
  options: { tours: 60, budgetMs: 1500 },
});

const resCount = await mesure({
  name: 'countUnoccluded',
  fichier: 'packages/sdk-browser/hizUnoccluded.ts',
  cas: jeux,
  calcul: (pages) => {
    const counts = createHizCounts();
    return {
      kept: urls(countUnoccluded(pages, pyramide, cameraMoteur(cam), viewport, counts)),
      counts,
    };
  },
  attendu: (pages) => {
    const counts = createHizCounts();
    return {
      kept: urls(referenceCountUnoccluded(pages, pyramide, cam, viewport, counts)),
      counts,
    };
  },
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'splitOccludersInto extremes',
  calcul: (p: SceneBox[]) => splitOccludersInto(p, cameraMoteur(cam), viewport, [], []),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'occlusion',
  [resSplit, resCount],
  'A3 and A4 isolate exact same occluders and reject exact same boxes',
);
