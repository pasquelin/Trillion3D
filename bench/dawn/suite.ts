// A series of bench runs under one lock, one page after the other, and the table of their first
// measured segments. At most five scenes, ever (`suiteRuns.ts`).
//   node bench/dawn/suite.ts [page[:scenario],…] [run options, as run.ts]
// The default is the bench's own generated scene, which carries every cost the engine counts.
import { readFileSync, writeFileSync } from 'node:fs'
import { measureOutput } from '../core/paths.ts'
import { runChild } from './child.ts'
import { LOCK_OWNER, takeBenchLock } from './lock.ts'
import type { BenchReport } from './merge.ts'
import { stamp } from './options.ts'
import { suiteRuns } from './suiteRuns.ts'
import { ms, percent, sameImages, table } from './reportText.ts'

const options = process.argv.slice(2)
const list = options[0] && !options[0].startsWith('--') ? options.shift() : undefined
const runs = suiteRuns(list)
takeBenchLock(`suite of ${runs.length}`)

const rows: (string | number)[][] = []
/** Runs that failed, or that measured with GPU errors (`run.ts` then ends 1): the suite fails. */
let failed = 0
for (const run of runs) {
  const [page, scenario = 'orbit'] = run.split(':')
  console.error(`suite: ${page} ${scenario}`)
  const child = await runChild(
    [new URL('./run.ts', import.meta.url).pathname, page, '--scenario', scenario, ...options],
    { ...process.env, [LOCK_OWNER]: String(process.pid) },
    true,
    24 * 3600_000,
  )
  const report = /^report: (.*)\.md$/m.exec(child.stdout ?? '')?.[1]
  if (!report) {
    failed++
    rows.push([page, scenario, `FAILED (${child.status ?? child.signal})`, ...Array(8).fill('')])
    continue
  }
  const merged = JSON.parse(readFileSync(`${report}.json`, 'utf8')) as BenchReport
  if (child.status !== 0) failed++
  const segment = merged.segments.find((s) => s.measured)!
  const stages = segment.benchPasses
    .slice(0, 3)
    .map((pass) => `${pass.name} ${ms(pass.median)}`)
    .join(', ')
  rows.push([
    child.status === 0 ? page : `${page} (${merged.errors.length} GPU errors)`,
    scenario,
    ms(segment.gpuMs?.median),
    percent(segment.spread),
    ms(segment.engineGpuMs?.median),
    ms(segment.cpuMs?.median),
    ms(segment.worstGpuMs),
    ms(segment.worstCpuMs),
    segment.hitchFrames.map((at) => at.length).join('·'),
    stages,
    sameImages(segment),
  ])
}
const head = ['page', 'scenario', 'GPU ms', 'plays spread', 'engine GPU ms', 'main thread ms']
head.push('worst GPU ms', 'worst main thread ms', 'hitches', 'top passes', 'images')
const text = [`# GPU bench suite — ${new Date().toISOString()}`, '', table(head, rows), ''].join(
  '\n',
)
const path = measureOutput('bench-gpu', `${stamp()}-suite.md`)
writeFileSync(path, text)
console.log(text)
console.log(`suite: ${path}`)
process.exitCode = failed ? 1 : 0
