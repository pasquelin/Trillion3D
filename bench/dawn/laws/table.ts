// A law's table again from its points' merged reports, in the law's point order: what `sweep.ts`
// prints, for reports measured before a column was added or read again later.
//   node bench/dawn/laws/table.ts <law> <report.json>…
import { readFileSync } from 'node:fs'
import type { BenchReport } from '../merge.ts'
import { lawTable, pointRow } from './lawTable.ts'
import { lawOf } from './points.ts'

const [name, ...reports] = process.argv.slice(2)
const law = lawOf(name ?? '')
if (reports.length > law.points.length)
  throw new Error(`LAW_TABLE: ${reports.length} reports for ${law.points.length} points`)
const rows = reports.map((path, k) =>
  pointRow(law.points[k].x, JSON.parse(readFileSync(path, 'utf8')) as BenchReport),
)
console.log(lawTable(law, rows))
