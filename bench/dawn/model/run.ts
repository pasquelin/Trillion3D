// The frame's cost model set against a measured frame: each pass's floor on this machine's peaks,
// its time, the ratio and the milliseconds above the floor, ranked.
//   node bench/dawn/model/run.ts <report.json> --peaks <peaks.json> [--segment <name>]
//     [--cover 1] [--reach 1] [--rough 0] [--placements 0]
// `report.json`: a bench run's merged report (`.mesure/out/bench-gpu/*.json`); `peaks.json`: the
// peaks' (`.mesure/out/peaks/*.json`). What no counter of the report says — the covered share of
// the pixels, the share a shadowed light reaches, the rough-reflective share, the placements the
// cut walks — is given; a floor taken from a share too large is lower, never higher.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { BenchReport } from '../merge.ts'
import type { Peaks } from './floor.ts'
import { frameOf, modelRows, modelText } from './modelTable.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    peaks: { type: 'string' },
    segment: { type: 'string' },
    cover: { type: 'string', default: '1' },
    reach: { type: 'string', default: '1' },
    rough: { type: 'string', default: '0' },
    placements: { type: 'string', default: '0' },
  },
})
if (!positionals[0] || !values.peaks)
  throw new Error('usage: node bench/dawn/model/run.ts <report.json> --peaks <peaks.json>')
const report = JSON.parse(readFileSync(positionals[0], 'utf8')) as BenchReport
const measured = JSON.parse(readFileSync(values.peaks, 'utf8')) as {
  rows: { resource: string; rate: number; bestRate: number }[]
}
// The best run of each benchmark is the peak: a floor no pass can pass under.
const peaks = Object.fromEntries(
  measured.rows.map((row) => [
    row.resource,
    row.resource.endsWith('Pass') ? row.rate : row.bestRate,
  ]),
) as Peaks
const frame = frameOf(report, {
  cover: Number(values.cover),
  reach: Number(values.reach),
  rough: Number(values.rough),
  placements: Number(values.placements),
})
console.log(modelText(modelRows(report, frame, peaks, values.segment), frame))
