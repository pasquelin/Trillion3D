// H3-2 : l'ordre de transfert des textures, recalculé à chaque image. Avant le lot, les deux
// tableaux de poids étaient des tableaux JavaScript agrandis d'une case à la fois ; après, deux
// `Float64Array` dont la capacité double. Le nombre de couches n'est pas connu quand la file naît —
// l'index des matériaux est refait à chaque scène chargée — d'où la croissance plutôt qu'une
// préallocation fixe. Les poids restent des doubles : `triangles` vaut `count / 3` sur un maillage
// transparent, et une addition IEEE 754 dans un `Float64Array` est celle d'un `number`.
//
// Le résultat prouvé est celui que le module rend : la file réordonnée, travail par travail, sur des
// coupes variées — poids fractionnaires, couches éparses, égalités parfaites, slots hors des poids,
// index absent, file trop courte pour être triée.
import { join } from 'node:path';
import { createTexturePriority } from '../webgpuTexturePriority.ts';
import { RACINE, compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { referenceTexturePriority } from './oracles/h3PriorityOracle.ts';

const alea = graine(9173);

/** Un travail de la file ; seuls `kind`, `slot`, `stage` et `nextRow` pèsent sur l'ordre. */
function travail(kind, slot, stage, nextRow) {
  return {
    kind,
    slot,
    classIndex: 0,
    layer: slot,
    level: 0,
    stage,
    bytes: 4,
    rows: 1,
    bytesPerRow: 4,
    nextRow,
    failures: 0,
    uploadRows: () => {},
  };
}

/**
 * Une coupe : `materiaux` matériaux lisant chacun des couches tirées sous `couches`, `pages` pages
 * demandées au cache et `transparents` maillages mélangés, dont le poids `count / 3` n'est pas
 * entier. `slots` borne les slots des travaux, éventuellement au-delà de la dernière couche vue.
 */
function coupe({ materiaux, couches, pages, transparents, travaux, slots, sansIndex = false }) {
  const index = new Map();
  const liste = [];
  for (let i = 0; i < materiaux; i++) {
    const material = { id: i };
    const color = [Math.floor(alea() * couches), Math.floor(alea() * couches)];
    const data = [Math.floor(alea() * couches), Math.floor(alea() * couches)];
    index.set(material, { color, data });
    liste.push(material);
  }
  const requested = [];
  for (let i = 0; i < pages; i++)
    requested.push({
      material: liste[Math.floor(alea() * materiaux)],
      triangles: 1 + Math.floor(alea() * 4000),
    });
  const blend = [];
  for (let i = 0; i < transparents; i++)
    blend.push({
      material: liste[Math.floor(alea() * materiaux)],
      count: 1 + Math.floor(alea() * 9000),
    });
  const jobs = [];
  for (let i = 0; i < travaux; i++)
    jobs.push(
      travail(
        alea() < 0.5 ? 'color' : 'data',
        Math.floor(alea() * slots),
        alea() < 0.4 ? 0 : 1,
        alea() < 0.3 ? 1 + Math.floor(alea() * 8) : 0,
      ),
    );
  const entrees = () => ({ index: sansIndex ? undefined : index, requested, blend });
  return { jobs, avant: referenceTexturePriority(entrees), apres: createTexturePriority(entrees) };
}

/** Chaque tour repart de la file telle qu'elle a été bâtie : `order` la trie en place. */
const joue = (cle) => (e) => {
  const liste = e.jobs.slice();
  e[cle].order(liste);
  return liste;
};

function cas(nom, options, mesure = true) {
  const entree = coupe(options);
  return { nom, taille: options.pages + options.transparents, mesure, entree };
}

const lignes = [
  await compare({
    calcul: 'H3-2 ordre de transfert des textures, par image',
    fichier: 'packages/sdk-browser/webgpuTexturePriority.ts',
    cas: [
      cas('3 000 pages, 400 matériaux, 200 couches, 48 travaux', {
        materiaux: 400,
        couches: 200,
        pages: 3000,
        transparents: 120,
        travaux: 48,
        slots: 260,
      }),
      cas('600 pages, couches éparses jusqu’à 5 000', {
        materiaux: 60,
        couches: 5000,
        pages: 600,
        transparents: 40,
        travaux: 32,
        slots: 6000,
      }),
      cas('coupe minuscule, slots tous hors des poids', {
        materiaux: 3,
        couches: 4,
        pages: 5,
        transparents: 2,
        travaux: 12,
        slots: 900,
      }),
      cas(
        'sans index de matériaux : l’ordre d’origine est gardé',
        {
          materiaux: 8,
          couches: 16,
          pages: 40,
          transparents: 8,
          travaux: 20,
          slots: 20,
          sansIndex: true,
        },
        false,
      ),
      cas(
        'file d’un seul travail : rien à trier',
        { materiaux: 4, couches: 8, pages: 10, transparents: 2, travaux: 1, slots: 8 },
        false,
      ),
      cas(
        'tous les poids égaux à zéro : le tri reste stable',
        { materiaux: 4, couches: 8, pages: 0, transparents: 0, travaux: 24, slots: 8 },
        false,
      ),
    ],
    reference: joue('avant'),
    optimisee: joue('apres'),
    options: { tours: 60, budgetMs: 3000, alterne: true },
  }),
];

verifieEtDepose(
  'priorite-h3',
  'H3-2 rend exactement la même file réordonnée',
  lignes,
  join(RACINE, '.mesure', 'calculs-h3'),
);
