// preloading the ring around the cut.
import {
  createSelectionResult,
  selectVisiblePages,
} from '../../../packages/sdk-browser/pageSelection.ts';
import type { ClusterRoot, SelectionResult } from '../../../packages/sdk-browser/pageSelection.ts';
import { compteur, mesure, parcours, rapport, stress } from '../../core/index.ts';
import { camera } from './support/scenes.ts';
import { dag, racine, type DagPage } from './support/dagCoupe.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/cameraFixture.ts';

interface Scene {
  roots: ClusterRoot<DagPage>[];
  pixelError: number;
  anneau: DagPage[];
  coupe: DagPage[];
  wantedAnneau: DagPage[];
  wantedCoupe: DagPage[];
  resultatAnneau: SelectionResult<DagPage>;
  resultatCoupe: SelectionResult<DagPage>;
}

const cam = camera(9, 0.1, 16 / 9);
const image: [number, number] = [1280, 720];

function scene({
  feuilles,
  seed,
  pixelError,
}: {
  feuilles: number;
  seed: number;
  pixelError: number;
}): Scene {
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

/** `exactPagesRequests.ts`: the ring is a second cut, at half the threshold. */
function anneauParSeconde(input: Scene) {
  const ring = selectVisiblePages(
    input.roots,
    cameraMoteur(cam),
    {
      pixelError: input.pixelError > 0 ? input.pixelError * 0.5 : 0.5,
      viewport: image,
      holdResident: false,
      wanted: input.wantedAnneau,
      result: input.resultatAnneau,
    },
    input.anneau,
  );
  return (ring.wanted.length ? ring.wanted : ring.shown).map((rec) => rec.url);
}

/** What the already-computed cut can give: its own pages, nothing finer. */
function anneauParLaCoupe(input: Scene) {
  const cut = selectVisiblePages(
    input.roots,
    cameraMoteur(cam),
    {
      pixelError: input.pixelError,
      viewport: image,
      holdResident: false,
      wanted: input.wantedCoupe,
      result: input.resultatCoupe,
    },
    input.coupe,
  );
  return (cut.wanted.length ? cut.wanted : cut.shown).map((rec) => rec.url);
}

/** The delta states both reasons at once: the ring is not the cut, and it is not per frame. */
function differencesAnneau(attendu: string[], obtenu: string[], name: string) {
  const c = parcours(compteur(), attendu, obtenu, name);
  if (c.nombre)
    c.premier =
      `the ring goes below the cut (${attendu.length} requested pages against ${obtenu.length} ` +
      'in the cut); it is not derived from it; and the second cut is not done per frame: ' +
      '`explorerDraw.ts` calls it only when the network is idle, after a delay';
  return c;
}

const dense = scene({ feuilles: 10000, seed: 79, pixelError: 8 });
const rare = scene({ feuilles: 2000, seed: 83, pixelError: 32 });

const resC3 = await mesure({
  name: 'ring via a second cut',
  fichier: 'packages/sdk-browser/exactPagesRequests.ts',
  cas: [
    { name: '20 000 pages, threshold 8 against 4', input: dense, size: 20000 },
    { name: '4 000 pages, threshold 32 against 16', input: rare, size: 4000 },
  ],
  calcul: anneauParLaCoupe,
  attendu: anneauParSeconde,
  // Cut cannot substitute for ring: benchmark quantifies difference.
  differences: differencesAnneau,
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

await stress({
  name: 'anneauParLaCoupe extremes',
  calcul: (s) => anneauParLaCoupe(s),
  extremes: [{ name: 'rare', input: rare }],
});

rapport('pages-anneau', [resC3], 'C3 was measured and the ring delta is described');
