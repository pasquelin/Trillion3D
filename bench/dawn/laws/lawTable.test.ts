import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BenchReport } from '../merge.ts'
import { lawTable, pointRow } from './lawTable.ts'
import { lawOf } from './points.ts'

/** A merged report with what a law reads: its measured segment, counters and CPU steps. */
const report = (gpu: number, pass: number, triangles: number) =>
  ({
    readySeconds: { median: 3 },
    segments: [
      { measured: false, benchPasses: [], passes: { passes: [] } },
      {
        measured: true,
        gpuMs: { median: gpu },
        engineCpuMs: { median: 1.5 },
        engineGpuMs: { median: 4.5 },
        cpuMs: { median: 4 },
        benchPasses: [
          { name: 'temporal antialiasing', median: pass },
          { name: 'HiZ', median: 0.001 },
        ],
        passes: { passes: [{ name: 'temporal antialiasing', median: pass + 1 }] },
      },
    ],
    engine: { selectedTriangles: triangles, clusters: 10 },
    cpuSteps: { frames: 9, steps: { worldMs: { p50: 0.2 }, gateMs: { p50: Number.NaN } } },
  }) as unknown as BenchReport

test('a point reads its measured segment, its passes, its counters and its CPU steps', () => {
  const row = pointRow(1000, report(5, 3, 1e6))
  assert.equal(row.gpuMs, 5)
  assert.equal(row.engineCpuMs, 1.5)
  assert.equal(row.passes['temporal antialiasing'], 3)
  assert.equal(row.counters.selectedTriangles, 1e6)
  assert.equal(row.counters.drawnTriangles, null, 'a counter the frame lacks')
  assert.equal(row.steps.worldMs, 0.2)
  assert.equal(row.steps.gateMs, null, 'an unmeasured bound')
  assert.equal(row.engineGpuMs, 4.5)
})

test('without the bench’s timer, a point reads the engine’s own per pass', () => {
  const r = report(5, 3, 1e6)
  const measured = r.segments[1] as unknown as { benchPasses: unknown[] }
  measured.benchPasses = []
  assert.equal(pointRow(1000, r).passes['temporal antialiasing'], 4)
})

test('the table puts the points across, a column per row, with its exponent and law', () => {
  const law = lawOf('world')
  const rows = [1e3, 1e4, 1e5].map((n) => pointRow(n, report(5, 3, n * 10)))
  const text = lawTable(law, rows)
  assert.match(text, /## Law: world — should be O\(1\) in N/)
  assert.match(text, /\| GPU ms \| 5\.00 \| 5\.00 \| 5\.00 \| 0\.00 \| O\(1\) \|/)
  assert.match(text, /\| selectedTriangles \| 10000 \| 100000 \| 1000000 \| 1\.00 \| O\(N\) \|/)
  assert.match(text, /temporal antialiasing/)
  assert.doesNotMatch(text, /\| HiZ \|/, 'a pass under the floor of every point is left out')
})
