// When the CPU cut publishes its own into the residency sets: AFTER its guards, and only for an
// image that draws. Publishing earlier made the cache hold — and forbade it from reclaiming — a cut
// the image never drew: the whole CPU cut while the pinned coverage it needs first was still in
// flight, or a cut refused by a guard and left behind in `run.desired`, `requested`, `keep` and the
// counters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import {
  collectClusterPages,
  createSelectionResult,
  type PageRec,
} from '../../../page/selection/selection.ts';
import { blendFixture, camera } from '../../../page/selection/blend.fixture.ts';
import { cameraMoteur } from '../../../camera/camera.fixture.ts';
import { createHizCounts } from '../../../hiz/hiz.ts';
import { renderCpuCut } from './cpu.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** An engine reduced to what the CPU cut walks before drawing. */
function banc(options: { ready: boolean; resident: boolean }) {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const residents = new Map(options.resident ? allPages.map((page) => [page.url, page]) : []);
  /** What `run.desired` carried before the image: the cut the previous image published. The bench
   *  camera only keeps `near`, so `far` alone says without ambiguity "nothing has moved". */
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
      geometryPool: { slots: 64 },
      texturePool: {},
      tracking: { traceSet: () => ({}), traceRecs: () => ({}) },
    },
    gpu: {
      device: fakeDevice().device,
      cache: { get: (url: string) => residents.get(url) },
      targetSize: [64, 64],
    },
    vis: { visEnabled: false, gpuHiz: undefined, textureJobs: [] },
    capture: { capturing: false },
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
      // The pool holds a cluster at its own address, which no page of this fixture quantizes.
      poolHolds: (rec: PageRec) => residents.has(rec.url),
      forgetReadback: () => journal.push('oubli'),
      adoptCpuCut: (wanted: readonly PageRec[]) => {
        journal.push('publication');
        run.desired.length = 0;
        for (const page of wanted) run.desired.push(page);
      },
      queueCutResidency: () => {
        journal.push('file');
        // The image stops here: everything that follows needs a device.
        throw new Error('BANC_ARRET');
      },
    },
  } as unknown as WebgpuPagesRuntime;
  return { rt, run, journal, tenue, cam: cameraMoteur(camera()) };
}

const image = (b: ReturnType<typeof banc>) => renderCpuCut(b.rt, b.cam, 0, 0, 0);

test('bootstrap in progress makes the CPU cut hold nothing', () => {
  const b = banc({ ready: false, resident: false });
  image(b);
  assert.deepEqual(b.journal, ['ressources', 'oubli'], 'neither publish nor queue');
  assert.deepEqual(b.run.desired, b.tenue, 'the requested cut stays the one from before the image');
});

test('an image that throws leaves no rejected cut behind', () => {
  // Coverage ready, but no resident page: the cut cannot be covered.
  const b = banc({ ready: true, resident: false });
  assert.throws(() => image(b), /GPU_COVERAGE_INCOMPLETE/);
  assert.deepEqual(b.journal, ['ressources', 'oubli'], 'nothing was published');
  assert.deepEqual(b.run.desired, b.tenue, 'the requested cut stays the one from before the image');
});

test('an image that passes its guards publishes its cut, just before queuing residency', () => {
  const b = banc({ ready: true, resident: true });
  assert.throws(() => image(b), /BANC_ARRET/, 'the bench stops at the queue, for lack of a device');
  assert.deepEqual(b.journal, ['ressources', 'oubli', 'publication', 'file'], 'in that order');
  assert.deepEqual(
    b.run.desired.map((page) => page.url),
    ['near'],
    'and it is the chosen cut that is published, not the previous one',
  );
});
