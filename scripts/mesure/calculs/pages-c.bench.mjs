// C3 : le préchargement de l'anneau autour de la coupe. Le mandat était de le dériver de la coupe
// déjà calculée au lieu de relancer `selectVisiblePages`. Deux faits s'y opposent, et le banc les
// montre plutôt que de les affirmer :
// 1. la seconde coupe n'est pas faite à chaque image — `explorerDraw.ts:54-59` ne l'appelle que
//    lorsque le réseau est au repos et qu'un délai est écoulé, donc le coût n'est pas par image ;
// 2. l'anneau est la coupe d'un seuil deux fois plus fin, qui descend sous la coupe affichée :
//    les pages qu'il demande ne sont pas dans la coupe, elles sont ses enfants. La dériver de la
//    coupe rendrait un autre ensemble, et le lot C refuse toute coupe qui change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSelectionResult,
  selectVisiblePages,
} from '../../../packages/sdk-browser/pageSelection.ts';
import { compareC, deposeC } from './bancC.mjs';
import { compteur, parcours } from './ecartsC.mjs';
import { camera } from './scenes.mjs';
import { dag, racine } from './dagC.mjs';

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

/** `exactPagesRequests.ts:111-127` : l'anneau est une seconde coupe, à la moitié du seuil. */
function anneauParSeconde(entree) {
  const ring = selectVisiblePages(
    entree.roots,
    cam,
    {
      pixelError: entree.pixelError > 0 ? entree.pixelError * 0.5 : 0.5,
      viewport: image,
      frame: 9,
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
    cam,
    {
      pixelError: entree.pixelError,
      viewport: image,
      frame: 9,
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
      "`explorerDraw.ts:54-59` ne l'appelle que réseau au repos, après un délai";
  return c;
}

const dense = scene({ feuilles: 10000, seed: 79, pixelError: 8 });
const rare = scene({ feuilles: 2000, seed: 83, pixelError: 32 });

const lignes = [
  await compareC({
    calcul: 'C3 anneau de préchargement',
    fichier: 'packages/sdk-browser/exactPagesRequests.ts',
    cas: [
      { nom: '20 000 pages, seuil 8 contre seuil 4', entree: dense, taille: 20000 },
      { nom: '4 000 pages, seuil 32 contre seuil 16', entree: rare, taille: 4000 },
    ],
    reference: anneauParSeconde,
    optimisee: anneauParLaCoupe,
    differences: differencesAnneau,
    options: { chauffe: 3, tours: 25, budgetMs: 2500 },
  }),
];

test("C3 a été mesuré et l'écart de l'anneau est décrit", () => {
  for (const ligne of lignes) {
    assert.ok(ligne.avantMs > 0, `${ligne.calcul} : aucune mesure`);
    assert.ok(ligne.identique || ligne.ecart, `${ligne.calcul} : écart non décrit`);
  }
});
deposeC('pages-c', lignes);
