// the three cluster-cut retries.
import {
  createSelectionResult,
  selectVisiblePages,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type {
  ClusterRoot,
  SelectionResult,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { ligneDecrite, mesure, stress, rapport } from '../../core/index.ts';
import { camera } from './support/scenes.ts';
import { dag, etatDeCoupe, racine, type DagPage } from './support/dagCut.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';

interface Scene {
  pages: DagPage[];
  roots: ClusterRoot<DagPage>[];
  shown: DagPage[];
  wanted: DagPage[];
  result: SelectionResult<DagPage>;
  pixelError: number;
  budget: number;
  rootFallback: boolean;
}

const cam = camera(9, 0.1, 16 / 9);
const image: [number, number] = [1280, 720];

function demande(input: Scene, pixelError: number, pageBudget: number) {
  return {
    pixelError,
    viewport: image,
    holdResident: true,
    rootFallback: input.rootFallback,
    pageBudget,
    wanted: input.wanted,
    result: input.result,
  };
}

function referenceCoupe(input: Scene) {
  const budget = input.budget;
  let pixelError = input.pixelError;
  let result = selectVisiblePages(
    input.roots,
    cameraMoteur(cam),
    demande(input, pixelError, 0),
    input.shown,
  );
  for (let attempt = 0; budget && result.shown.length > budget && attempt < 16; attempt++) {
    pixelError = pixelError > 0 ? pixelError * 2 : 1;
    result = selectVisiblePages(
      input.roots,
      cameraMoteur(cam),
      demande(input, pixelError, 0),
      input.shown,
    );
  }
  return etatDeCoupe(result);
}

function optimiseeCoupe(input: Scene) {
  const result = selectVisiblePages(
    input.roots,
    cameraMoteur(cam),
    demande(input, input.pixelError, input.budget),
    input.shown,
  );
  return etatDeCoupe(result);
}

function scene({
  feuilles,
  seed,
  residentes = 1,
  pixelError,
  budget,
  rootFallback = false,
}: {
  feuilles: number;
  seed: number;
  residentes?: number;
  pixelError: number;
  budget: number;
  rootFallback?: boolean;
}): Scene {
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
  name: 'retry on budget',
  fichier: 'packages/sdk-browser/src/page/cut/cut.ts',
  cas: [
    { name: '20 000 pages, budget 300 exceeded', input: serre, size: 20000 },
    { name: '20 000 pages, budget held', input: large, size: 20000 },
    { name: '8 000 pages, no budget', input: sansBudget, size: 8000 },
  ],
  calcul: optimiseeCoupe,
  attendu: referenceCoupe,
  options: { chauffe: 2, tours: 15, budgetMs: 1500 },
});

const decritC6 = ligneDecrite({
  name: 'memorized repair threshold',
  fichier: 'packages/sdk-browser/src/page/cut/repair.ts',
  motif: 'not kept: the stepwise climb seeks the smallest fixed point',
});
const decritC4 = ligneDecrite({
  name: 'second forcing pass',
  fichier: 'packages/sdk-browser/src/page/cut/select.ts',
  motif: 'not measured: the second pass changes the predicate for every page',
});

await stress({
  name: 'selectVisiblePages extremes',
  calcul: (s) => selectVisiblePages(s.roots, cameraMoteur(cam), demande(s, 1, 0), []),
  extremes: [{ name: 'sansBudget', input: sansBudget }],
});

rapport(
  'selection-relances',
  [resC5, decritC6, decritC4],
  'C4, C5 and C6 were measured or described',
);
