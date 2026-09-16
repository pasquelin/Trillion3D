// A3 et A4 : le partage des occulteurs et le test d'occlusion d'une coupe entière.
// Référence = le code d'avant, recopié tel quel dans `oracles/occlusion.mjs` (`splitOccluders`,
// `projectBoxToScreen`, `countUnoccluded`) ; optimisée = `splitOccludersInto` et `countUnoccluded`
// du paquet. Les deux côtés appellent le même `hizRejects` : la ligne A4 mesure la projection seule,
// le gain du choix de niveau de mip étant porté par la ligne A5 et compté une seule fois.
import { createHizCounts } from '../hizCounts.ts';
import { countUnoccluded } from '../hizUnoccluded.ts';
import { splitOccludersInto } from '../hizSplit.ts';
import { buildHizPyramid } from '../hizDepth.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
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
const lignes = [
  await compare({
    calcul: 'A3 splitOccluders',
    fichier: 'packages/sdk-browser/hizSplit.ts',
    cas: jeux,
    reference: (pages) => {
      const split = referenceSplitOccluders(pages, cam, viewport);
      return { occluders: urls(split.occluders), rest: urls(split.rest) };
    },
    optimisee: (pages) => {
      splitOccludersInto(pages, cameraMoteur(cam), viewport, occluders, rest);
      return { occluders: urls(occluders), rest: urls(rest) };
    },
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A4 countUnoccluded',
    fichier: 'packages/sdk-browser/hizUnoccluded.ts',
    cas: jeux,
    reference: (pages) => {
      const counts = createHizCounts();
      return {
        kept: urls(referenceCountUnoccluded(pages, pyramide, cam, viewport, counts)),
        counts,
      };
    },
    optimisee: (pages) => {
      const counts = createHizCounts();
      return {
        kept: urls(countUnoccluded(pages, pyramide, cameraMoteur(cam), viewport, counts)),
        counts,
      };
    },
    options: { tours: 200, budgetMs: 2000 },
  }),
];

verifieEtDepose(
  'occlusion',
  'A3 et A4 rendent exactement les mêmes pages et les mêmes comptes',
  lignes,
);
