// Quand la coupe processeur publie la sienne dans les ensembles de résidence : APRÈS ses gardes, et
// seulement pour une image qui dessine. Publier plus tôt faisait tenir au cache — et lui interdisait
// de rendre — une coupe que l'image n'a jamais dessinée : toute la coupe processeur pendant que la
// couverture épinglée dont il a besoin d'abord était encore en vol, ou une coupe refusée par une
// garde et laissée derrière dans `run.desired`, `requested`, `keep` et les compteurs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, createSelectionResult, type PageRec } from './pageSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { createHizCounts } from './hiz.ts';
import { renderCpuCut } from './webgpuPagesRenderCpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un moteur réduit à ce que la coupe processeur traverse avant de dessiner. */
function banc(options: { ready: boolean; resident: boolean }) {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const residents = new Map(options.resident ? allPages.map((page) => [page.url, page]) : []);
  /** Ce que `run.desired` portait avant l'image : la coupe que l'image précédente a publiée. La
   *  caméra du banc ne retient que `near`, donc `far` seul dit sans ambiguïté « rien n'a bougé ». */
  const tenue = [allPages.find((page) => page.url === 'far')!];
  const journal: string[] = [];
  const run = {
    gate: { resourcesChanged: () => journal.push('ressources') },
    shown: [] as PageRec[],
    desired: [...tenue],
    drawn: [] as PageRec[],
    selectResult: createSelectionResult<PageRec>(),
    requestedScratch: new Set<string>(),
    transitionScratch: new Set<string>(),
    readyScratch: [] as PageRec[],
    opaqueScratch: [] as PageRec[],
    transparentScratch: [] as PageRec[],
    culledScratch: [] as PageRec[],
    coverageBudgetLimited: false,
    coverageBudgetEvent: undefined,
    cpuSelectMs: null as number | null,
    pagesEntered: 0 as number | null,
    pagesExited: 0 as number | null,
    overBudget: false,
    visible: 0,
    selectedTriangles: 0,
    submittedTriangles: 0,
    drawnTriangles: 0,
    blendPagedTriangles: 0,
    uncoveredTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
    gpuDrawCalls: 0,
    frame: 3,
    imageRevision: 2,
    drawnMirrorsShown: true,
    temporalHizState: {},
    cpuHizCounts: createHizCounts(),
    cpuHizCounted: false,
  };
  const rt = {
    run,
    setup: {
      roots,
      viewport: [64, 64] as [number, number],
      bootstrapUrls: new Set<string>(),
      bootstrap: [] as PageRec[],
      slots: 64,
      gpuDevice: {},
      geometryPool: { slots: 64 },
      texturePool: {},
      tracking: { traceSet: () => ({}), traceRecs: () => ({}) },
    },
    gpu: { cache: { get: (url: string) => residents.get(url) }, targetSize: [64, 64] },
    vis: { visEnabled: false, gpuHiz: undefined, textureJobs: [] },
    capture: { secondaryCamera: false },
    blendState: { visibleBlend: [] },
    timing: { marks: { preStart: 0 }, cpuSample: undefined },
    diag: {
      traceEnabled: false,
      traceDiagnostic: () => {},
      diagnosticFailure: () => {},
      engineDiagnostic: () => {},
    },
    services: {
      bootstrapState: { ready: options.ready },
      residencySets: { keepCount: 0 },
      hasBytes: () => true,
      forgetReadback: () => journal.push('oubli'),
      adoptCpuCut: (wanted: readonly PageRec[]) => {
        journal.push('publication');
        run.desired.length = 0;
        for (const page of wanted) run.desired.push(page);
      },
      queueCutResidency: () => {
        journal.push('file');
        // L'image s'arrête ici : tout ce qui suit demande un appareil.
        throw new Error('BANC_ARRET');
      },
    },
  } as unknown as WebgpuPagesRuntime;
  return { rt, run, journal, tenue, cam: cameraMoteur(camera()) };
}

const image = (b: ReturnType<typeof banc>) => renderCpuCut(b.rt, b.cam, 0, 0, 0);

test('l’amorçage en cours ne fait rien tenir de la coupe processeur', () => {
  const b = banc({ ready: false, resident: false });
  image(b);
  assert.deepEqual(b.journal, ['ressources', 'oubli'], 'ni publication ni mise en file');
  assert.deepEqual(b.run.desired, b.tenue, 'la coupe demandée reste celle d’avant l’image');
});

test('une image qui lève ne laisse derrière elle aucune coupe rejetée', () => {
  // Couverture prête, mais aucune page résidente : la coupe ne peut pas être couverte.
  const b = banc({ ready: true, resident: false });
  assert.throws(() => image(b), /GPU_COVERAGE_INCOMPLETE/);
  assert.deepEqual(b.journal, ['ressources', 'oubli'], 'rien n’a été publié');
  assert.deepEqual(b.run.desired, b.tenue, 'la coupe demandée reste celle d’avant l’image');
});

test('une image qui passe ses gardes publie sa coupe, juste avant de mettre la résidence en file', () => {
  const b = banc({ ready: true, resident: true });
  assert.throws(() => image(b), /BANC_ARRET/, 'le banc s’arrête à la file, faute d’appareil');
  assert.deepEqual(b.journal, ['ressources', 'oubli', 'publication', 'file'], 'dans cet ordre');
  assert.deepEqual(
    b.run.desired.map((page) => page.url),
    ['near'],
    'et c’est la coupe choisie qui est publiée, pas celle d’avant',
  );
});
