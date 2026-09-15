// C4, C5 et C6 : les trois relances de la coupe de clusters.
// C5 : référence = l'ancien `pageSelectionCut.ts:82-86`, la coupe entière refaite jusqu'à seize
// fois — rejouée ici en appelant la sélection sans budget, ce qui est exactement ce que faisait son
// `sweep()`. L'optimisée demande le budget et s'arrête à la page qui dépasse. La règle du lot : la
// coupe, pages affichées et demandées dans l'ordre, doit être strictement identique.
// C4 et C6 : lignes décrites, sans code — la raison est écrite dans l'entrée du tableau. Ni l'un ni
// l'autre ne peut rendre une coupe identique, et une coupe qui change n'est pas une optimisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSelectionResult,
  selectVisiblePages,
} from '../../../packages/sdk-browser/pageSelection.ts';
import { compareC, deposeC, ligneDecrite } from './bancC.mjs';
import { compteur, parcours } from './ecartsC.mjs';
import { camera } from './scenes.mjs';
import { dag, etatDeCoupe, racine } from './dagC.mjs';

const cam = camera(9, 0.1, 16 / 9);
const image = [1280, 720];

/** Une demande de coupe neuve : la sélection réécrit l'objet, jamais l'appelant. */
function demande(entree, pixelError, pageBudget) {
  return {
    pixelError,
    viewport: image,
    frame: entree.frame,
    holdResident: true,
    rootFallback: entree.rootFallback,
    pageBudget,
    wanted: entree.wanted,
    result: entree.result,
  };
}

/** Remet les estampilles à zéro : l'écart des deux côtés doit être celui de la coupe, pas d'un reste. */
function neuf(entree) {
  for (const page of entree.pages) page.seen = 0;
}

/**
 * `pageSelectionCut.ts:82-86` avant le lot C : un passage complet, puis jusqu'à seize passages
 * complets de plus, chacun au double du seuil précédent. Sans budget la sélection ne s'arrête
 * jamais en route : un appel sans budget est mot pour mot l'ancien `sweep()`.
 */
function referenceCoupe(entree) {
  neuf(entree);
  const budget = entree.budget;
  let pixelError = entree.pixelError;
  let result = selectVisiblePages(entree.roots, cam, demande(entree, pixelError, 0), entree.shown);
  for (let attempt = 0; budget && result.shown.length > budget && attempt < 16; attempt++) {
    pixelError = pixelError > 0 ? pixelError * 2 : 1;
    result = selectVisiblePages(entree.roots, cam, demande(entree, pixelError, 0), entree.shown);
  }
  return etatDeCoupe(result, entree.pages);
}

function optimiseeCoupe(entree) {
  neuf(entree);
  const result = selectVisiblePages(
    entree.roots,
    cam,
    demande(entree, entree.pixelError, entree.budget),
    entree.shown,
  );
  return etatDeCoupe(result, entree.pages);
}

/**
 * L'écart d'une coupe, en deux parts : ce qui définit la coupe — pages affichées et demandées dans
 * l'ordre, compteurs, seuil rendu — et les estampilles `seen`, qui ne définissent rien. Un passage
 * abandonné ne pose plus les estampilles des pages qu'il ne verra pas ; personne ne les lit, et la
 * coupe rendue est la même. Le banc les compte à part au lieu de les confondre avec la coupe.
 */
function differencesCoupe(attendu, obtenu, nom) {
  const { estampilles: avant, ...coupeAvant } = attendu;
  const { estampilles: apres, ...coupeApres } = obtenu;
  const c = parcours(compteur(), coupeAvant, coupeApres, `${nom} coupe`);
  const stamps = parcours(compteur(), avant, apres, `${nom} estampilles`);
  c.horsCoupe = stamps.nombre;
  c.nombre += stamps.nombre;
  c.premier ??= stamps.nombre
    ? `coupe identique ; ${stamps.nombre} estampilles que les passages abandonnés ne posent plus`
    : null;
  return c;
}

function scene({ feuilles, seed, residentes = 1, pixelError, budget, rootFallback = false }) {
  const pages = dag({ feuilles, seed, residentes });
  return {
    pages,
    roots: [racine(pages)],
    shown: [],
    wanted: [],
    result: createSelectionResult(),
    frame: 41,
    pixelError,
    budget,
    rootFallback,
  };
}

// Budget volontairement dépassé : la coupe fine tient des milliers de pages, le budget en veut 300.
const serre = scene({ feuilles: 10000, seed: 61, pixelError: 2, budget: 300 });
// Budget tenu du premier coup : aucun passage n'est abandonné, les deux côtés font le même travail.
const large = scene({ feuilles: 10000, seed: 67, pixelError: 8, budget: 30000 });
// Aucun budget : la boucle de relance n'existe pas, le drapeau ne doit rien changer.
const sansBudget = scene({ feuilles: 4000, seed: 71, pixelError: 2, budget: 0 });

const lignes = [
  await compareC({
    calcul: 'C5 relance sur budget',
    fichier: 'packages/sdk-browser/pageSelectionCut.ts',
    cas: [
      { nom: '20 000 pages, budget 300 dépassé', entree: serre, taille: 20000 },
      { nom: '20 000 pages, budget tenu du premier coup', entree: large, taille: 20000 },
      { nom: '8 000 pages, aucun budget', entree: sansBudget, taille: 8000 },
    ],
    reference: referenceCoupe,
    optimisee: optimiseeCoupe,
    differences: differencesCoupe,
    // La coupe doit être identique page pour page ; les estampilles `seen` n'en font pas partie.
    tolere: (c) => c.nombre === c.horsCoupe,
    options: { chauffe: 3, tours: 25, budgetMs: 3000 },
  }),
  ligneDecrite({
    calcul: 'C6 seuil de réparation mémorisé',
    fichier: 'packages/sdk-browser/pageSelectionCutRepair.ts',
    ecart:
      'non retenu : la montée par paliers cherche le plus petit point fixe au-dessus du seuil de ' +
      "l'image. Repartir d'un seuil mémorisé donne un point fixe plus grand, donc une coupe plus " +
      "grossière : le résultat cesse d'être une fonction de l'entrée, il dépend de ce qui a été " +
      'demandé avant. Aucune réécriture ne rend la coupe identique, et la mesure sur 8 000 pages ' +
      "dont 45 % manquantes n'a montré aucun gain. Le commit est reverté.",
  }),
  ligneDecrite({
    calcul: 'C4 second parcours de forçage',
    fichier: 'packages/sdk-browser/pageSelectionCutSelect.ts',
    ecart:
      'non mesuré : le second parcours ne rejoue pas la coupe, il change de prédicat pour toutes ' +
      'les pages (`drawnUnderForcing` au lieu de `cutSelects`), pas seulement sous les groupes ' +
      'forcés. Ne retraverser que les sous-arbres touchés rendrait un autre ensemble et un autre ' +
      "ordre d'émission : la coupe ne serait pas identique.",
  }),
];

test('C4, C5 et C6 ont été mesurés ou décrits', () => {
  for (const ligne of lignes)
    assert.ok(ligne.identique || ligne.ecart, `${ligne.calcul} : écart non décrit`);
});
deposeC('selection-c', lignes);
