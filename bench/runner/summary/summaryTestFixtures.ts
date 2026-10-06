// Shared fixtures for `summary/summary.test.ts`, `summary/summaryCoverage.test.ts` and `summary/summaryCompute.test.ts`:
// split out to keep the files under the line budget.
import type { Report, Row } from '../report/types.ts'

/** A minimal report: one series, one side, just what `resume()` reads. */
export function rapport(side: Partial<Row>): Report {
  return {
    startedAt: 't0',
    provenance: { machine: null, browser: null, displayCapHz: null },
    campaignIdentity: null,
    engine: 'engine-test',
    scene: 'scene-test',
    command: 'pnpm run measure',
    head: 'abc123',
    pathVersion: 1,
    flags: [],
    resources: null,
    sides: {
      a: {
        dist: 'dist-test',
        from: 'develop',
        cache: null,
        engine: 'engine-test',
        variant: null,
        errorMetric: 'certifiee',
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
        witnessAA: null,
        beforeAfterDiff: null,
        sides: { a: side as Row },
      },
    ],
  }
}

export const baseSide: Partial<Row> = {
  engine: undefined,
  cpuFrameMs: null,
  cpuSelectMs: null,
  gpuFrameMs: null,
  stageProfile: null,
  selectedTriangles: null,
  uncoveredTriangles: null,
  drawnTriangles: null,
  submittedTriangles: null,
  totalSubmittedTriangles: null,
  frameHeld: null,
  gpuSelectionFallback: null,
  hiZ: {
    tested: null,
    rejected: null,
    beyond16Texels: null,
    testedTriangles: null,
    rejectedTriangles: null,
    beyond16TexelsTriangles: null,
    image: null,
  },
  selection: { source: null, sha256: null, count: 0 },
  pageBudget: {
    requested: 32,
    resident: null,
    budgetLimitedCoverage: null,
  },
  geometryBytes: null,
  load: { start: [], end: [] },
}

/** The first data row of the table under `## ${section}` in a `resume()` text, keyed by header. */
export function tableRow(text: string, section: string): Record<string, string> {
  const lines = text.split('\n')
  const from = lines.indexOf(`## ${section}`)
  if (from < 0) throw new Error(`no section ${section}`)
  const rows = lines.slice(from).filter((line) => line.startsWith('|'))
  const cells = (line: string) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
  const values = cells(rows[2])
  return Object.fromEntries(cells(rows[0]).map((header, i) => [header, values[i]]))
}
