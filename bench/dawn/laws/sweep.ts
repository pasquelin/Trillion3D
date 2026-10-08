// Scale laws measured: each point of each law (`points.ts`) a bench run of the scene family
// (`world.html`) under one lock, the cooked scenes made first, then each law's table — per point
// the frame, the passes and the counters, per column the exponent it grows with (`lawTable.ts`).
//   node bench/dawn/laws/sweep.ts <law>[,<law>…] [--repeat 1] [--cpu-profile]
//     [--only <x,…>] [-- <run options for every point>]
// Laws: world, runtime, pixels, lights, distance. Each run measures the machine once and keeps it
// (`../machine.ts`). Waits for the machine's bench lock. Tables land in
// `.mesure/out/laws/`, each run's report in `.mesure/out/bench-gpu/`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { measureOutput } from '../../core/paths.ts'
import { runChild } from '../child.ts'
import { LOCK_OWNER, waitBenchLock } from '../lock.ts'
import type { BenchReport } from '../merge.ts'
import { stamp } from '../options.ts'
import { cookPoint } from './cook.ts'
import { lawTable, pointRow, type PointRow } from './lawTable.ts'
import { lawOf, type Law } from './points.ts'

const here = (file: string) => new URL(file, import.meta.url).pathname

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    repeat: { type: 'string', default: '1' },
    'cpu-profile': { type: 'boolean', default: false },
    only: { type: 'string' },
  },
})
const [names, ...extra] = positionals
const only = values.only?.split(',').map(Number)
const laws = (names ?? '').split(',').map((name) => {
  const law = lawOf(name)
  return { ...law, points: law.points.filter((point) => !only || only.includes(point.x)) }
})
for (const point of laws.flatMap((law) => law.points))
  if (point.scene !== null) cookPoint(point.scene === 'object' ? null : point.scene)

const points = laws.reduce((sum, law) => sum + law.points.length, 0)
const release = await waitBenchLock(`laws ${names} (${points} points)`)
const env = { ...process.env, [LOCK_OWNER]: String(process.pid) }
let failures = 0
for (const law of laws) failures += await measure(law)
release()
process.exit(failures ? 1 : 0)

/** Runs `law`'s points, writes and prints its table; resolves to its failed points. */
async function measure(law: Law) {
  const rows: PointRow[] = []
  const failed: string[] = []
  for (const point of law.points) {
    console.error(`law ${law.name}: ${law.x} = ${point.x}`)
    const args = [here('../run.ts'), here('./world.html'), '--scenario', here('./sway.json')]
    args.push('--repeat', values.repeat, ...point.args, ...extra)
    if (values['cpu-profile']) args.push('--cpu-profile')
    const child = await runChild(args, env, true, 3600_000)
    const report = /^report: (.*)\.md$/m.exec(child.stdout ?? '')?.[1]
    if (!report) {
      failed.push(`${point.x}: ended ${child.status ?? child.signal}`)
      continue
    }
    rows.push(pointRow(point.x, JSON.parse(readFileSync(`${report}.json`, 'utf8')) as BenchReport))
    if (child.status !== 0) failed.push(`${point.x}: GPU errors`)
  }
  const out = measureOutput('laws')
  mkdirSync(out, { recursive: true })
  const stem = join(out, `${stamp()}-${law.name}`)
  const text = [lawTable(law, rows), failed.length ? `Failed: ${failed.join('; ')}` : ''].join('\n')
  writeFileSync(`${stem}.json`, JSON.stringify({ law, rows, failed }, null, 1))
  writeFileSync(`${stem}.md`, text)
  console.log(text)
  console.log(`law: ${stem}.md`)
  return failed.length
}
