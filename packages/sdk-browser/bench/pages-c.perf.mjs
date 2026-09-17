// C3 : le préchargement de l'anneau autour de la coupe.
import { createSelectionResult, selectVisiblePages } from '../pageSelection.ts';
import { ligneDecrite, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera } from './scenes.mjs';
import { dag, racine } from './dagC.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const cam = camera(9, 0.1, 16 / 9);
const image = [1280, 720];

function scene({ feuilles, seed, pixelError }) {
  const pages = dag({ feuilles, seed, residentes: 0.8 });
  return {
    roots: [racine(pages)],
    pixelError,
    anneau: [],
    coupe: [],
    wantedAnneau: [],
    wantedCoupe: [],
    resultatAnneau: createSelectionResult(),
    resultatCoupe: createSelectionResult(),
  };
}

function anneauParSeconde(entree) {
  const ring = selectVisiblePages(
    entree.roots,
    cameraMoteur(cam),
    {
      pixelError: entree.pixelError > 0 ? entree.pixelError * 0.5 : 0.5,
      viewport: image,
      holdResident: false,
      wanted: entree.wantedAnneau,
      result: entree.resultatAnneau,
    },
    entree.anneau,
  );
  return (ring.wanted.length ? ring.wanted : ring.shown).map((rec) => rec.url);
}

function anneauParLaCoupe(entree) {
  const cut = selectVisiblePages(
    entree.roots,
    cameraMoteur(cam),
    {
      pixelError: entree.pixelError,
      viewport: image,
      holdResident: false,
      wanted: entree.wantedCoupe,
      result: entree.resultatCoupe,
    },
    entree.coupe,
  );
  return (cut.wanted.length ? cut.wanted : cut.shown).map((rec) => rec.url);
}

const dense = scene({ feuilles: 10000, seed: 79, pixelError: 8 });
const rare = scene({ feuilles: 2000, seed: 83, pixelError: 32 });

const resC3 = await mesure({
  nom: 'C3 anneau de préchargement',
  fichier: 'packages/sdk-browser/exactPagesRequests.ts',
  cas: [
    { nom: '20 000 pages, seuil 8 contre 4', entree: dense, taille: 20000 },
    { nom: '4 000 pages, seuil 32 contre 16', entree: rare, taille: 4000 },
  ],
  calcul: anneauParLaCoupe,
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

await stress({
  nom: 'anneauParLaCoupe extremes',
  calcul: (s) => anneauParLaCoupe(s),
  extremes: [{ nom: 'rare', entree: rare }],
});

rapport('pages-c', [resC3], "C3 a été mesuré et l'écart de l'anneau est décrit");
