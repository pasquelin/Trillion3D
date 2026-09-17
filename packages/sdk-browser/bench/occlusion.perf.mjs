// A3 et A4 : partage des occulteurs et test d'occlusion d'une coupe entière.
import { createHizCounts } from '../hizCounts.ts';
import { countUnoccluded } from '../hizUnoccluded.ts';
import { splitOccludersInto } from '../hizSplit.ts';
import { buildHizPyramid } from '../hizDepth.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { boites, camera } from './scenes.mjs';
import { referenceCountUnoccluded, referenceSplitOccluders } from './oracles/occlusion.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const LARGEUR = 640,
  HAUTEUR = 360;
const alea = graine(29),
  profondeur = new Float32Array(LARGEUR * HAUTEUR);
for (let i = 0; i < profondeur.length; i++) profondeur[i] = alea() * 0.4 + 0.5;
const pyramide = buildHizPyramid(profondeur, LARGEUR, HAUTEUR);
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport = [LARGEUR, HAUTEUR];
const grande = boites({ count: 20000 }),
  cas = (pages, nom) => ({ nom, entree: pages, taille: pages.length });
const jeux = [
  cas(grande, '20 000 boîtes dont dégénérées'),
  cas(grande.slice(0, 1), 'une boîte'),
  cas([], 'aucune boîte'),
  cas(grande.filter((_, i) => i % 311 === 0).slice(0, 64), 'que des coupes du plan proche'),
];

const urls = (pages) => pages.map((page) => page.url);
const occluders = [],
  rest = [];

const resSplit = await mesure({
  nom: 'A3 splitOccluders',
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
  nom: 'A4 countUnoccluded',
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
  nom: 'splitOccludersInto extremes',
  calcul: (p) => splitOccludersInto(p, cameraMoteur(cam), viewport, [], []),
  extremes: [
    { nom: 'vide', entree: [] },
  ],
});

rapport('occlusion', [resSplit, resCount], 'A3 et A4 isolent les mêmes occulteurs et rejettent les mêmes boîtes');
