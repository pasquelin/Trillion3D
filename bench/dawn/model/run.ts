// The frame's cost model set against a measured frame: each pass's floor on this machine's rates,
// its time, the ratio and the milliseconds above the floor, ranked.
//   node bench/dawn/model/run.ts <report.json> --machine <machine.json> [--segment <name>]
//     [--cover 1] [--reach 1] [--reflecting 0] [--placements 0]
// `report.json`: a bench run's merged report (`.mesure/out/bench-gpu/*.json`); `machine.json`: the
// machine a run measured and kept (`../machine.ts`, `~/.trillion3d/machine/`). What no counter of the report says — the covered share of
// the pixels, the share a shadowed light reaches, the reflecting share, the placements the
// cut walks — is given; a floor taken from a share too large is lower, never higher.
import { parseArgs } from 'node:util'
import type { BenchReport } from '../merge.ts'
import type { Machine } from '../machine.ts'
import { frameOf, modelRows, modelText } from './modelTable.ts'
import { readJson } from '../../../scripts/repository-files.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    machine: { type: 'string' },
    segment: { type: 'string' },
    cover: { type: 'string', default: '1' },
    reach: { type: 'string', default: '1' },
    reflecting: { type: 'string', default: '0' },
    placements: { type: 'string', default: '0' },
  },
})
if (!positionals[0] || !values.machine)
  throw new Error('usage: node bench/dawn/model/run.ts <report.json> --machine <machine.json>')
const report = readJson(positionals[0]) as BenchReport
const machine = readJson(values.machine) as Machine
const frame = frameOf(report, {
  cover: Number(values.cover),
  reach: Number(values.reach),
  reflecting: Number(values.reflecting),
  placements: Number(values.placements),
})
console.log(modelText(modelRows(report, frame, machine, values.segment), frame))
