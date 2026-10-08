// The frame's cost model against a measured frame: each pass's floor (`floor.ts`) from its work
// (`passes.ts`) on the machine's rates (`../machine.ts`), its measured time (the bench's own share of the pass,
// `../passTimer.ts`), their ratio and the milliseconds above the floor, ranked by the latter.
// Passes the model does not hold are listed with their time alone. Pure.
import type { BenchReport } from '../merge.ts'
import { table } from '../reportText.ts'
import { floorOf } from './floor.ts'
import type { Machine } from '../machine.ts'
import { PASSES, type Frame } from './passes.ts'

/** The frame a bench report measured: its sizes and counters, with what no counter says. */
export function frameOf(
  report: BenchReport,
  given: { cover: number; reach: number; rough: number; placements: number },
): Frame {
  const engine = report.engine as Record<string, number | null | undefined>
  const display = report.bench.display as { width: number; height: number }
  return {
    P: (engine.renderWidth ?? 0) * (engine.renderHeight ?? 0),
    D: display.width * display.height,
    cover: given.cover,
    T: engine.drawnTriangles ?? engine.selectedTriangles ?? 0,
    R: engine.clusters ?? 0,
    N: given.placements,
    L: engine.shadowVsmLights ?? 0,
    reach: given.reach,
    rough: given.rough,
  }
}

/** The rows of the model against the measured segment `segment` of `report`. */
export function modelRows(
  report: BenchReport,
  frame: Frame,
  machine: Partial<Machine>,
  segment?: string,
) {
  const measured = report.segments.find((s) => (segment ? s.name === segment : s.measured))!
  const times = new Map(measured.benchPasses.map((pass) => [pass.name, pass.median]))
  const rows = PASSES.map((pass) => {
    const floor = floorOf(pass.work(frame), machine)
    const ms = times.get(pass.label) ?? 0
    times.delete(pass.label)
    return {
      label: pass.label,
      formula: pass.formula,
      floorMs: floor.ms,
      bound: floor.bound,
      ms,
      ratio: floor.ms > 0 ? ms / floor.ms : null,
      aboveMs: ms - floor.ms,
    }
  }).filter((row) => row.ms > 0)
  const unmodelled = [...times].map(([label, ms]) => ({ label, ms })).filter((row) => row.ms > 0)
  rows.sort((a, b) => b.aboveMs - a.aboveMs)
  unmodelled.sort((a, b) => b.ms - a.ms)
  return { rows, unmodelled, frameMs: measured.gpuMs?.median ?? null }
}

const f2 = (value: number | null) => (value === null ? '—' : value.toFixed(2))

/** The rows as Markdown. */
export function modelText(model: ReturnType<typeof modelRows>, frame: Frame) {
  const head = ['pass', 'work', 'floor ms', 'bound by', 'measured ms', 'ratio', 'ms above floor']
  return [
    `Frame: P ${frame.P}, D ${frame.D}, T ${frame.T}, R ${frame.R}, L ${frame.L}; GPU ${f2(model.frameMs)} ms.`,
    '',
    table(
      head,
      model.rows.map((r) => [
        r.label,
        r.formula,
        r.floorMs.toFixed(3),
        r.bound,
        r.ms.toFixed(3),
        f2(r.ratio),
        r.aboveMs.toFixed(3),
      ]),
    ),
    '',
    'Not modelled: ' + model.unmodelled.map((r) => `${r.label} ${r.ms.toFixed(3)}`).join(' · '),
    '',
  ].join('\n')
}
