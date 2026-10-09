// A law's measured curve as a table: per point, the frame's GPU and CPU time, the passes that
// weigh, the engine's counters that say what was drawn, and per column the exponent it grows with.
// Pure: reads the bench's merged reports (`../merge.ts`).
import type { BenchReport } from '../merge.ts'
import { table } from '../reportText.ts'
import { exponentOf, lawName } from './fit.ts'
import type { Law } from './points.ts'

/** The engine counters a law reads off a point's last frame. */
const COUNTERS = [
  'selectedTriangles',
  'drawnTriangles',
  'clusters',
  'residentPages',
  'shadowVsmPagesRequested',
  'gpuAllocatedBytes',
] as const

/** One point's numbers: the measured segment's medians, and the counters. */
export function pointRow(x: number, report: BenchReport) {
  const segment = report.segments.find((s) => s.measured)!
  // The bench's timer, or the engine's own where the engine timed every image (a world whose
  // render scale is steered: `webgpu/pages/prepare/timing.ts`), which leaves the bench's aside.
  const timed = segment.benchPasses.length ? segment.benchPasses : segment.passes.passes
  const passes = Object.fromEntries(timed.map((pass) => [pass.name, pass.median]))
  const engine = report.engine as Record<string, number | null | undefined>
  const counters = Object.fromEntries(COUNTERS.map((key) => [key, engine[key] ?? null]))
  // The engine's CPU bounds over the profiled play (`world.cpuSteps()`), each at its median.
  const profiled = report.cpuSteps as { steps?: Record<string, { p50: number }> } | null
  const steps = Object.fromEntries(
    Object.entries(profiled?.steps ?? {}).map(([name, step]) => [
      name,
      Number.isFinite(step.p50) ? step.p50 : null,
    ]),
  )
  return {
    x,
    gpuMs: segment.gpuMs?.median ?? null,
    engineGpuMs: segment.engineGpuMs?.median ?? null,
    engineCpuMs: segment.engineCpuMs?.median ?? null,
    mainThreadMs: segment.cpuMs?.median ?? null,
    readySeconds: report.readySeconds?.median ?? null,
    passes,
    counters,
    steps,
  }
}
export type PointRow = ReturnType<typeof pointRow>

const cell = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value >= 100 ? value.toFixed(0) : value.toFixed(2)

/** The columns worth a line: the frame's, every pass above `minMs` at any point, the counters. */
function columns(rows: readonly PointRow[], minMs: number) {
  const passes = [...new Set(rows.flatMap((row) => Object.keys(row.passes)))].filter((name) =>
    rows.some((row) => (row.passes[name] ?? 0) >= minMs),
  )
  const steps = [...new Set(rows.flatMap((row) => Object.keys(row.steps)))].filter((name) =>
    rows.some((row) => (row.steps[name] ?? 0) >= minMs),
  )
  return [
    ['GPU ms', (row: PointRow) => row.gpuMs],
    ['engine GPU ms', (row: PointRow) => row.engineGpuMs],
    ['engine CPU ms', (row: PointRow) => row.engineCpuMs],
    ['main thread ms', (row: PointRow) => row.mainThreadMs],
    ['ready s', (row: PointRow) => row.readySeconds],
    ...passes.map((name) => [name, (row: PointRow) => row.passes[name] ?? 0]),
    ...steps.map((name) => [`cpu ${name}`, (row: PointRow) => row.steps[name]]),
    ...COUNTERS.map((key) => [key, (row: PointRow) => row.counters[key]]),
  ] as [string, (row: PointRow) => number | null | undefined][]
}

/** The law's table, one row a column (the points across), each with its exponent and law. */
export function lawTable(law: Law, rows: readonly PointRow[], minMs = 0.05) {
  const xs = rows.map((row) => row.x)
  const body = columns(rows, minMs).map(([name, read]) => {
    const ys = rows.map(read)
    const exponent = exponentOf(
      xs,
      ys.map((y) => y ?? Number.NaN),
    )
    return [name, ...ys.map(cell), exponent === null ? '—' : exponent.toFixed(2), lawName(exponent)]
  })
  const head = [law.x, ...xs.map((x) => String(x)), 'exponent', 'law']
  return [`## Law: ${law.name} — should be ${law.should}`, '', table(head, body), ''].join('\n')
}
