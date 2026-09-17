// le préchargement de l'anneau autour de la coupe.
import { createSelectionResult, selectVisiblePages } from '../pageSelection.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compteur, mesure, parcours, rapport, stress } from '../../sdk-core/bench/socle.mjs';
import { camera } from './appui/scenes.mjs';
import { dag, racine } from './appui/dagCoupe.mjs';
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

/** `exactPagesRequests.ts` : l'anneau est une seconde coupe, à la moitié du seuil. */
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

/** Ce que la coupe déjà calculée peut donner : ses propres pages, rien de plus fin. */
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

/** L'écart dit les deux raisons d'un coup : l'anneau n'est pas la coupe, et il n'est pas par image. */
function differencesAnneau(attendu, obtenu, nom) {
  const c = parcours(compteur(), attendu, obtenu, nom);
  if (c.nombre)
    c.premier =
      `l'anneau descend sous la coupe (${attendu.length} pages demandées contre ${obtenu.length} ` +
      "dans la coupe), il ne s'en dérive pas ; et la seconde coupe n'est pas faite par image : " +
      "`explorerDraw.ts` ne l'appelle que réseau au repos, après un délai";
  return c;
}

const dense = scene({ feuilles: 10000, seed: 79, pixelError: 8 });
const rare = scene({ feuilles: 2000, seed: 83, pixelError: 32 });

const resC3 = await mesure({
  nom: 'anneau par seconde coupe',
  fichier: 'packages/sdk-browser/exactPagesRequests.ts',
  cas: [
    { nom: '20 000 pages, seuil 8 contre 4', entree: dense, taille: 20000 },
    { nom: '4 000 pages, seuil 32 contre 16', entree: rare, taille: 4000 },
  ],
  calcul: anneauParLaCoupe,
  attendu: anneauParSeconde,
  differences: differencesAnneau,
  // La coupe ne peut pas tenir lieu d'anneau : le banc chiffre ce qui les sépare, il ne l'efface pas.
  ecartPublie: true,
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

test("chaque cas de C3 publie l'écart de l'anneau", () => {
  for (const r of resC3.resultats) assert.ok(r.motif, `${r.nom} : écart non chiffré`);
});

await stress({
  nom: 'anneauParLaCoupe extremes',
  calcul: (s) => anneauParLaCoupe(s),
  extremes: [{ nom: 'rare', entree: rare }],
});

rapport('pages-anneau', [resC3], "C3 a été mesuré et l'écart de l'anneau est décrit");
