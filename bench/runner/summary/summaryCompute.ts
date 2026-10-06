// The batch calculation path, as the governor published it, for `resume.md`.
import type { FrameMetrics } from '../../../packages/sdk-core/src/index.ts'
import type { Report } from '../report/types.ts'

export type MathBatch = NonNullable<FrameMetrics['mathBatch']>
export type MathOperation = MathBatch['operations'][string]

/** A median, or "unmeasured": a dash would not be distinct from a measured zero. */
const ns = (value: number | null | undefined) => (value == null ? 'unmeasured' : value.toFixed(1))

/** WebAssembly module state of a side, with the cause when it is not playable. */
function module(reading: MathBatch) {
  if (!reading.wasmAvailable) return reading.unavailableReason ?? 'unavailable'
  return (
    `loaded${reading.wasmSimd ? ', simd128' : ''}` +
    (reading.clockCoarse ? ', coarse clock, pooled timing' : '')
  )
}

/**
 * The calculation path of each side: what the governor CHOSE, operation by operation, and the two
 * medians that decided it. A `--math-path js|wasm` campaign rereads its forced mode there,
 * `auto` rereads the arbitration. Nothing is inferred: a side without a reading says so, a side
 * that ran no batch says so too.
 */
export function computePaths(report: Report) {
  const lines = [
    '| view | pixelError | side | mode | module | operation | path | js ns/elt | wasm ns/elt | switches | elements |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const series of report.series)
    for (const [side, result] of Object.entries(series.sides)) {
      const reading = result.mathBatch
      const tete = `| ${series.view} | ${series.pixelError} | ${side} `
      if (!reading) {
        lines.push(`${tete}| — | reading missing from this dist | — | — | — | — | — | — |`)
        continue
      }
      const state = `| ${reading.mode} | ${module(reading)} `
      const operations = Object.entries(reading.operations ?? {})
      if (!operations.length) {
        lines.push(`${tete}${state}| no batch run | — | — | — | — | — |`)
        continue
      }
      for (const [nom, o] of operations)
        lines.push(
          `${tete}${state}| ${nom} | ${o.path ?? '—'} | ${ns(o.jsNsPerElement)} ` +
            `| ${ns(o.wasmNsPerElement)} | ${o.switches} | ${o.elements} |`,
        )
    }
  return lines
}
