// The GPU bench: a site page drawn by the engine in Node on this machine's GPU (Dawn), no browser,
// through a scenario played the same on every run, `--repeat` times in fresh processes.
//   node bench/dawn/run.ts <page> [--scenario orbit|drive|still|world|<file.json>] [--repeat 3]
//     [--switch trillion3dXOld=1]… [--scale 0.5|page] [--profile desktop|mobile]
//     [--display 4112x2294@2] [--features-off subgroups,shader-f16] [--cpu-profile] [--warm 120]
//     [--engine <checkout, e.g. .worktrees/831-serve>] [--dirty] [--recalibrate] [--dissect <pass label> [--dissect-segment <name>]]
// <page>: an example's name (`drive-a-car`), a path, or a validation page's prefix (`v06`) with
// TRILLION3D_VALIDATION_DIR set; a scenario file may name its page. One bench at a time on the
// machine (`lock.ts`). The report, JSON and Markdown, lands in `.mesure/out/bench-gpu/`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
import { runChild } from './child.ts'
import { LOCK_OWNER, takeBenchLock } from './lock.ts'
import { dissect } from './dissect.ts'
import { buildInsights } from './insights.ts'
import { mergePlays } from './merge.ts'
import { engineSources, findPassSources } from './passSource.ts'
import { benchOptions, stamp } from './options.ts'
import { playScenario, type BenchPlay } from './play.ts'
import { reportText } from './reportText.ts'

const options = benchOptions()
const label = `${options.name} ${options.scenario.name}${options.search}`

takeBenchLock(label)

if (options.childReport) {
  // One play of a repeated run, in a process of its own: a fresh page, the same situation. Its
  // images are named after its report. Whatever happens, the play ends: a hung GPU or page never
  // holds the machine. The run waits as long for each of its plays (`runChild`), so `--timeout`
  // bounds a play, never the whole run.
  setTimeout(() => {
    console.error(`BENCH_TIMEOUT: ${label} past ${options.timeoutS} s`)
    process.exit(3)
  }, options.timeoutS * 1000).unref()
  const play = await playScenario(options, options.childReport.replace(/\.json$/, ''))
  writeFileSync(options.childReport, JSON.stringify(play))
  process.exit(0)
}

if (options.dissect) {
  const { stem, text } = await dissect(options, options.dissect, options.dissectSegment)
  console.log(text)
  console.log(`report: ${stem}.md`)
  process.exit(0)
}

const out = measureOutput('bench-gpu')
mkdirSync(out, { recursive: true })
const variant = options.profileName === 'desktop' ? '' : `-${options.profileName}`
const stem = join(out, `${stamp()}-${options.name}-${options.scenario.name}${variant}`)
const plays: BenchPlay[] = []
const args = process.argv.slice(2).filter((arg) => arg !== '--cpu-profile')
for (let k = 0; k < options.repeat; k++) {
  // The last play is the profiled one when the CPU is profiled: the others' timings stand
  // without the profiler's cost.
  const profiled = options.cpuProfile && k === options.repeat - 1
  const report = `${stem}-play${k + 1}.json`
  const child = await runChild(
    [process.argv[1], ...args, '--child-report', report, ...(profiled ? ['--cpu-profile'] : [])],
    // The run that holds the lock lends it on: this run's, or the suite's it is a child of.
    { ...process.env, [LOCK_OWNER]: process.env[LOCK_OWNER] ?? String(process.pid) },
    false,
    options.timeoutS * 1000,
  )
  if (child.status !== 0)
    throw new Error(`BENCH_PLAY: play ${k + 1} of ${label} ended ${child.status ?? child.signal}`)
  plays.push(JSON.parse(readFileSync(report, 'utf8')) as BenchPlay)
}
const merged = mergePlays(plays)
// Every pass's label read back to the engine's code: its file, line, function and shaders.
const names = [...new Set(merged.segments.flatMap((s) => s.benchPasses.map((p) => p.name)))]
const insights = buildInsights(merged, findPassSources(engineSources(options.engine.root), names))
// One JSON and one Markdown a run: the plays' own files were its intermediates.
writeFileSync(`${stem}.json`, JSON.stringify({ ...merged, insights }, null, 1))
for (const play of plays.keys()) rmSync(`${stem}-play${play + 1}.json`, { force: true })
const text = reportText(merged, insights)
writeFileSync(`${stem}.md`, text)
console.log(text)
console.log(`report: ${stem}.md`)
process.exit(merged.errors.length ? 1 : 0)
