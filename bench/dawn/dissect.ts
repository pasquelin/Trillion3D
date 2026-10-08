// `run.ts <page> --dissect <pass label>`: the cost of each step of one pass's shader, found by the
// bench alone. A first play lists the shader modules the pass runs and their `// @cut` points
// (`shaderCuts.ts`); then one play per cut, each with its shader made stopped at that point in
// memory, between two plays of the shader whole. The pass's time and the frame's, each cut against
// the one before, are the steps. The repository is not touched.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
import { runChild } from './child.ts'
import { childArgs } from './childArgs.ts'
import type { DissectSpec } from './dissectHooks.ts'
import { dissectText, stepsOf, type Variant } from './dissectReport.ts'
import { LOCK_OWNER } from './lock.ts'
import { stamp, type BenchOptions } from './options.ts'
import type { BenchPlay } from './play.ts'
import { passKey } from './summary.ts'

/** One play of the dissect scenario, with the shader as `spec` says: its numbers. */
async function playVariant(
  options: BenchOptions,
  scenario: string,
  spec: DissectSpec,
  out: string,
) {
  const report = join(out, `${stamp()}-dissect-variant.json`)
  const args = [
    process.argv[1],
    options.file,
    '--scenario',
    scenario,
    '--engine',
    options.engine.root,
    ...childArgs(process.argv.slice(2)),
    '--child-report',
    report,
  ]
  const child = await runChild(
    args,
    {
      ...process.env,
      [LOCK_OWNER]: process.env[LOCK_OWNER] ?? String(process.pid),
      TRILLION3D_DISSECT: JSON.stringify(spec),
    },
    false,
    options.timeoutS * 1000,
  )
  if (child.status !== 0)
    throw new Error(
      `BENCH_DISSECT: a play of ${spec.cut ?? 'the whole shader'} ended ${child.status}`,
    )
  const play = JSON.parse(readFileSync(report, 'utf8')) as BenchPlay
  rmSync(report, { force: true })
  return play
}

/** The variant numbers of a play: the dissect segment's frame and the pass's own medians. */
function numbersOf(play: BenchPlay, pass: string, cut: string | null): Variant {
  if (!Number.isFinite(play.segments[0].numbers.gpuMs?.median))
    throw new Error(`BENCH_DISSECT: the play of ${cut ?? 'the whole shader'} timed no frame`)
  const [segment] = play.segments
  // The pass named, whole: its exact name, else the one pass whose label holds it — never several.
  const exact = segment.benchPasses.filter((p) => p.name === passKey(pass))
  const mine = exact.length ? exact : segment.benchPasses.filter((p) => p.label.includes(pass))
  if (new Set(mine.map((p) => p.name)).size > 1)
    throw new Error(
      `BENCH_DISSECT: "${pass}" names several passes (${mine.map((p) => p.name).join(', ')}): name one`,
    )
  return {
    cut,
    frameMs: segment.numbers.gpuMs?.median ?? Number.NaN,
    passMs: mine.reduce((sum, p) => sum + p.median, 0),
    iqrMs: segment.numbers.gpuMs?.iqr ?? 0,
  }
}

/** Dissects `pass` on the first measured segment of the run's scenario. Resolves to the report's path. */
export async function dissect(options: BenchOptions, pass: string, segmentName?: string) {
  const out = measureOutput('bench-gpu')
  mkdirSync(out, { recursive: true })
  const segment = options.scenario.segments.find(
    (s) => s.measure !== false && (!segmentName || s.name === segmentName),
  )
  if (!segment) throw new Error(`BENCH_DISSECT: no measured segment ${segmentName ?? ''}`)
  // The segment alone, played on (a still image would redraw nothing): its camera, its gesture.
  const scenario = join(out, `${stamp()}-dissect-scenario.json`)
  writeFileSync(
    scenario,
    JSON.stringify({
      name: 'dissect',
      page: options.name,
      segments: [{ ...segment, capture: false }],
    }),
  )
  try {
    console.error(`dissect: listing the shaders of "${pass}"`)
    const listing = await playVariant(options, scenario, { pass, hash: '', cut: null }, out)
    // The module the pass sets most is the one the segment runs; the others are variants it met less.
    const modules = Object.values(listing.dissect)
      .flat()
      .filter((m) => m.cuts.length)
      .sort((a, b) => b.count - a.count)
    if (!modules.length) {
      const held = Object.entries(listing.dissect).flatMap(([label, ms]) =>
        ms.map((m) => `${label} ${m.hash}`),
      )
      throw new Error(
        `BENCH_DISSECT: no shader of "${pass}" holds a "// @cut name keep: …" line (modules seen: ${held.join(', ') || 'none'})`,
      )
    }
    const [{ hash, cuts }] = modules
    const run = (cut: string | null) => playVariant(options, scenario, { pass, hash, cut }, out)
    const variants: Variant[] = []
    variants.push(numbersOf(await run(null), pass, null))
    for (const cut of cuts) {
      console.error(`dissect: cut ${cut}`)
      variants.push(numbersOf(await run(cut), pass, cut))
    }
    variants.push(numbersOf(await run(null), pass, null))
    const result = stepsOf(cuts, variants)
    const stem = join(out, `${stamp()}-dissect-${pass.replace(/\W+/g, '-')}`)
    writeFileSync(`${stem}.md`, dissectText(pass, segment.name, result, variants))
    writeFileSync(
      `${stem}.json`,
      JSON.stringify(
        { pass, segment: segment.name, module: hash, cuts, ...result, variants },
        null,
        1,
      ),
    )
    return { stem, text: dissectText(pass, segment.name, result, variants) }
  } finally {
    rmSync(scenario, { force: true })
  }
}
