// `resume.md`, for `bench.ts`: the counters, the cuts and the image deltas of a run, never a time.
import { MIB } from '../../../packages/math/src/constants.ts'
import { computePaths } from './summaryCompute.ts'
import { textures } from './summaryTextures.ts'
import { memoire } from './summaryMemory.ts'
import { stalls } from './summaryDag.ts'
import { referenceLines } from '../references/referenceProof.ts'
import type { ImageDiff, Report, Row } from '../report/types.ts'

const num = (value: number | string | null | undefined) => (value == null ? '—' : String(value))
/** Bytes in megabytes, or a dash: a zero would not be distinct from an absent reading. */
const mo = (value: number | null | undefined) => (value == null ? '—' : (value / MIB).toFixed(1))
/** A three-state witness: `yes`, `no`, or a dash when this engine does not publish it. */
const oui = (value: boolean | null | undefined) => (value == null ? '—' : value ? 'yes' : 'no')
/** Reservoirs requested of the engine: in MiB when the bench gave them, otherwise its defaults. */
const pool = (bytes: number | null | undefined) =>
  bytes == null ? 'engine default' : `${mo(bytes)} MiB`
const budgets = (settings: Report['settings']) => {
  const parts = [
    `geometry pool ${pool(settings.geometryPoolBytes)}`,
    `texture pool ${pool(settings.texturePoolBytes)}`,
  ]
  if (settings.maxPages != null) parts.push(`ceiling ${settings.maxPages} pages`)
  return parts.join(', ')
}
const diffText = (d: ImageDiff | undefined) =>
  !d
    ? '—'
    : 'error' in d
      ? d.error
      : `${d.pixels} px, max channel ${d.maxChannel}, mean ${d.meanChannel.toFixed(3)}, p99.9 ${d.p999Channel}`
/**
 * Coverage relation of a reading: `selected − drawn − uncovered`. Zero says every triangle
 * of the cut is either submitted to draw or counted as a hole; anything else says one of
 * the three counters describes another image. A dash when one of the three is missing — nothing is inferred.
 */
const couverture = (r: Row) =>
  r.selectedTriangles == null || r.drawnTriangles == null || r.uncoveredTriangles == null
    ? '—'
    : String(r.selectedTriangles - r.drawnTriangles - r.uncoveredTriangles)

/** The series table: one row per view, per threshold and per side. */
function rows(report: Report) {
  const lines = [
    '| view | pixelError | side | selectedTriangles | drawnTriangles | coverage | submitted triangles opaque/total | held image | uncoveredTriangles | Hi-Z tested/rejected/>16 (image) | cut hash | page budget | geometry (MB) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const series of report.series)
    for (const [side, r] of Object.entries(series.sides)) {
      const hiz = r.hiZ
      lines.push(
        `| ${series.view} | ${series.pixelError} | ${side}${r.engine ? ` · ${r.engine}` : ''} ` +
          `| ${num(r.selectedTriangles)} | ${num(r.drawnTriangles)} | ${couverture(r)} ` +
          `| ${num(r.submittedTriangles)}/${num(r.totalSubmittedTriangles)} | ${oui(r.frameHeld)} ` +
          `| ${num(r.uncoveredTriangles)} ` +
          `| ${num(hiz.tested)}/${num(hiz.rejected)}/${num(hiz.beyond16Texels)} (${num(hiz.image)}) ` +
          `| ${r.selection.sha256 ? r.selection.sha256.slice(0, 12) : '—'} (${num(r.selection.source)}) ` +
          `| ${num(r.pageBudget.requested)} requested, ${num(r.pageBudget.resident)} resident ` +
          `| ${mo(r.geometryBytes)} |`,
      )
    }
  return lines
}

/** The engine's texture counters and the network of each series, one block per side. */
function counters(report: Report) {
  return report.series.flatMap((series) =>
    Object.entries(series.sides).flatMap(([side, result]) => [
      `### ${series.view} · e${series.pixelError} · ${side}`,
      '',
      ...textures(result.metrics, result),
    ]),
  )
}

/** `resume.md`: what the series recorded, and nothing else. A dash is an absence, not a zero. */
export function resume(report: Report) {
  const lines = [
    `# Measurement ${report.engine} — ${report.scene}`,
    '',
    `- Harness: \`${report.command}\``,
    `- Repository HEAD: \`${report.head}\` — sides: ` +
      Object.entries(report.sides)
        .map(([name, side]) => `${name} = ${side.from}`)
        .join(', '),
    `- Frames per series: ${report.settings.frames} (warmup ${report.settings.warmup}), ` +
      `${report.settings.width}×${report.settings.height}, ${budgets(report.settings)}`,
    `- Start ${report.startedAt}, end ${report.finishedAt}`,
    '',
    '## Readings',
    '',
    ...rows(report),
    '',
    '## Counters per series',
    '',
    '"unmeasured" is not zero.',
    '',
    ...counters(report),
    '## Batch compute path',
    '',
    'The published path is the one the governor chose by measurement, operation by operation:',
    'no threshold is written in the code, and "unmeasured" is not zero.',
    '',
    ...computePaths(report),
    '',
    '## GPU memory',
    '',
    'The total is what the engine allocated on the device and has not yet destroyed, computed from',
    'each descriptor: WebGPU does not publish occupied memory. "unmeasured" is not zero.',
    '',
    ...memoire(report),
    '',
    ...stalls(report),
    '## A/A witness and before/after delta',
    '',
    '| view | pixelError | A/A witness (same side, two captures) | before vs after |',
    '|---|---|---|---|',
    ...report.series.map(
      (s) =>
        `| ${s.view} | ${s.pixelError} | ${diffText(s.witnessAA)} | ${diffText(s.beforeAfterDiff)} |`,
    ),
    '',
    ...referenceLines(report),
  ]
  if (report.errors.length) {
    lines.push('## Page errors', '')
    for (const error of report.errors.slice(0, 40))
      lines.push(
        `- ${error.kind} : ${'message' in error ? error.message : error.status + ' ' + error.url}`,
      )
    lines.push('')
  }
  return lines.join('\n')
}
