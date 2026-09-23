// Shared fixtures for `summary.test.ts` and `summaryCoverage.test.ts`: split out to keep both
// files under the line budget.
import type { Report, Row } from './report/types.ts';

/** A minimal report: one series, one side, just what `resume()` reads. */
export function rapport(side: Partial<Row>): Report {
  return {
    startedAt: 't0',
    provenance: { machine: null, browser: null, displayCapHz: null },
    campaignIdentity: null,
    engine: 'moteur-test',
    scene: 'scene-test',
    commande: 'pnpm run mesure',
    head: 'abc123',
    pathVersion: 1,
    flags: [],
    ressources: null,
    sides: {
      a: {
        dist: 'dist-test',
        from: 'develop',
        cache: null,
        moteur: 'moteur-test',
        variante: null,
        erreur: 'certifiee',
      },
    },
    settings: { frames: 8, warmup: 2, width: 640, height: 360, maxPages: 32 } as Report['settings'],
    finishedAt: 't1',
    errors: [],
    series: [
      {
        view: 'salon',
        pixelError: 1,
        segment: 'segment-test',
        index: 0,
        pose: { position: [0, 0, 0], target: [0, 0, 0], fov: 55, near: 0.1, far: 100 },
        temoinAA: null,
        ecartAvantApres: null,
        sides: { a: side as Row },
      },
    ],
  };
}

export const baseSide: Partial<Row> = {
  moteur: undefined,
  cpuFrameMs: null,
  cpuSelectMs: null,
  gpuFrameMs: null,
  profilParEtape: null,
  selectedTriangles: null,
  uncoveredTriangles: null,
  drawnTriangles: null,
  submittedTriangles: null,
  totalSubmittedTriangles: null,
  imageTenue: null,
  repliSelectionGpu: null,
  hiZ: {
    tested: null,
    rejected: null,
    beyond16Texels: null,
    testedTriangles: null,
    rejectedTriangles: null,
    beyond16TexelsTriangles: null,
    image: null,
  },
  selection: { source: null, sha256: null, taille: 0 },
  budgetPages: {
    demande: 32,
    residentes: null,
    couvertureLimiteeParBudget: null,
    seuilBudget: null,
  },
  geometrieOctets: null,
  charge: { debut: [], fin: [] },
};
