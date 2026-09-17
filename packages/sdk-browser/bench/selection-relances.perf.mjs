// C4, C5 et C6 : les trois relances de la coupe de clusters.
import { createSelectionResult, selectVisiblePages } from '../pageSelection.ts';
import { ligneDecrite, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera } from './scenes.mjs';
import { dag, etatDeCoupe, racine } from './dagCoupe.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const cam = camera(9, 0.1, 16 / 9);
const image = [1280, 720];

function demande(entree, pixelError, pageBudget) {
  return {
    pixelError,
    viewport: image,
    holdResident: true,
    rootFallback: entree.rootFallback,
    pageBudget,
    wanted: entree.wanted,
    result: entree.result,
  };
}

function referenceCoupe(entree) {
  const budget = entree.budget;
  let pixelError = entree.pixelError;
  let result = selectVisiblePages(
    entree.roots,
    cameraMoteur(cam),
    demande(entree, pixelError, 0),
    entree.shown,
  );
  for (let attempt = 0; budget && result.shown.length > budget && attempt < 16; attempt++) {
    pixelError = pixelError > 0 ? pixelError * 2 : 1;
    result = selectVisiblePages(
      entree.roots,
      cameraMoteur(cam),
      demande(entree, pixelError, 0),
      entree.shown,
    );
  }
  return etatDeCoupe(result);
}

function optimiseeCoupe(entree) {
  const result = selectVisiblePages(
    entree.roots,
    cameraMoteur(cam),
    demande(entree, entree.pixelError, entree.budget),
    entree.shown,
  );
  return etatDeCoupe(result);
}

function scene({ feuilles, seed, residentes = 1, pixelError, budget, rootFallback = false }) {
  const pages = dag({ feuilles, seed, residentes });
  return {
    pages,
    roots: [racine(pages)],
    shown: [],
    wanted: [],
    result: createSelectionResult(),
    pixelError,
    budget,
    rootFallback,
  };
}

const serre = scene({ feuilles: 10000, seed: 61, pixelError: 2, budget: 300 });
const large = scene({ feuilles: 10000, seed: 67, pixelError: 8, budget: 30000 });
const sansBudget = scene({ feuilles: 4000, seed: 71, pixelError: 2, budget: 0 });

const resC5 = await mesure({
  nom: 'C5 relance sur budget',
  fichier: 'packages/sdk-browser/pageSelectionCut.ts',
  cas: [
    { nom: '20 000 pages, budget 300 dépassé', entree: serre, taille: 20000 },
    { nom: '20 000 pages, budget tenu', entree: large, taille: 20000 },
    { nom: '8 000 pages, aucun budget', entree: sansBudget, taille: 8000 },
  ],
  calcul: optimiseeCoupe,
  attendu: referenceCoupe,
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

const decritC6 = ligneDecrite({
  nom: 'C6 seuil de réparation mémorisé',
  fichier: 'packages/sdk-browser/pageSelectionCutRepair.ts',
  motif: 'non retenu : la montée par paliers cherche le plus petit point fixe',
});
const decritC4 = ligneDecrite({
  nom: 'C4 second parcours de forçage',
  fichier: 'packages/sdk-browser/pageSelectionCutSelect.ts',
  motif: 'non mesuré : le second parcours change de prédicat pour toutes les pages',
});

await stress({
  nom: 'selectVisiblePages extremes',
  calcul: (s) =>
    selectVisiblePages(
      s.roots,
      cameraMoteur(cam),
      demande(s, 1, 0),
      [],
    ),
  extremes: [{ nom: 'sansBudget', entree: sansBudget }],
});

rapport('selection-c', [resC5, decritC6, decritC4], 'C4, C5 et C6 ont été mesurés ou décrits');
