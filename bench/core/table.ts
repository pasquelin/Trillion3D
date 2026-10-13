// Rendering of a measurement row, written once. Benchmark console and aggregated table
// compose the exact same cells in the same order: they cannot display two formats of
// the same figure. Only regression icons distinguish the two outputs; the witness column has none.
import { gapLevel } from './baseline.ts'
import type { ResultRow } from '../kit/measureTypes.ts'

const ms = (v: number | null) => (v === null ? 'null' : v.toFixed(3))
const ns = (v: number | null) => (v === null ? '—' : v.toFixed(1))

const COLUMNS = [
  'Median (ms)',
  'P95 (ms)',
  'ns/element',
  'Ops/s',
  'vs baseline',
  'vs witness',
  'Oracle',
  'Note',
]

/** A Markdown table as lines: the head, its separator and a line a row of cells. The one writer of
 *  every bench's tables, console, report and summary. */
export function tableLines(head: string[], rows: (string | number)[][]) {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]
}

/** `tableLines` as one text. */
export const table = (head: string[], rows: (string | number)[][]) =>
  tableLines(head, rows).join('\n')

/** Header and its separator, preceded by columns added on the left by caller. */
export function header(before: string[] = []) {
  return tableLines([...before, ...COLUMNS], [])
}

function gapText(v: number | null | undefined, pastilles: boolean) {
  const level = gapLevel(v)
  if (level === 'absent' || v === null || v === undefined) return '—'
  const pct = `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`
  if (!pastilles) return pct
  if (level === 'failure') return `🔴 ${pct}`
  if (level === 'warning') return `⚠️ ${pct}`
  return pct
}

/** Table row. `before` holds left columns (domain, measurement) of the aggregate. */
export function ligneMd(
  r: ResultRow,
  { before = [], pastilles = false }: { before?: string[]; pastilles?: boolean } = {},
) {
  const cellules = [
    ms(r.medianeMs),
    ms(r.p95Ms),
    ns(r.nsParElement),
    r.opsParSec ?? 'null',
    gapText(r.ecartBaseline, pastilles),
    gapText(r.ecartTemoin, false),
    r.correct === null ? '—' : r.correct ? '✓' : '✗',
    r.motif ?? '',
  ]
  return `| ${[...before, r.name, ...cellules].join(' | ')} |`
}
