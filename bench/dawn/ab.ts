// `run.ts <page> --ab <checkout A> <checkout B>`: is B faster than A, or is it noise? The same page
// (the bench's own, so the two sides play one scene), the same scenario, plays that alternate the two
// engines round after round — A B, B A, A B… — so what the machine drifts by between rounds falls on
// both. Each play is a fresh process; each round's difference is B − A; the verdict reads its
// interval (`abStats.ts`), on the frame's GPU time of every measured segment.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
import { compare, type Comparison } from './abStats.ts'
import { runChild } from './child.ts'
import { childArgs } from './childArgs.ts'
import { LOCK_OWNER } from './lock.ts'
import { stamp, type BenchOptions } from './options.ts'
import type { BenchPlay } from './play.ts'
import { engineRoot } from './engineRoot.ts'
import { ms, percent, table } from './reportText.ts'

/** Rounds an A/B plays unless `--rounds` says; each is two plays. */
export const DEFAULT_ROUNDS = 6

/** One play of `root`'s engine on `page`: its numbers. */
async function play(options: BenchOptions, page: string, root: string, out: string) {
  const report = join(out, `${stamp()}-ab-play.json`)
  const child = await runChild(
    [
      process.argv[1],
      page,
      '--scenario',
      options.scenarioArg,
      '--engine',
      root,
      ...childArgs(process.argv.slice(2)),
      '--child-report',
      report,
    ],
    { ...process.env, [LOCK_OWNER]: process.env[LOCK_OWNER] ?? String(process.pid) },
    false,
    options.timeoutS * 1000,
  )
  if (child.status !== 0) throw new Error(`BENCH_AB: a play of ${root} ended ${child.status}`)
  const result = JSON.parse(readFileSync(report, 'utf8')) as BenchPlay
  rmSync(report, { force: true })
  return result
}

/** The segments' comparisons of the rounds `a` and `b` (plays of A and of B, in round order). */
export function compareRounds(a: readonly BenchPlay[], b: readonly BenchPlay[], least: number) {
  return a[0].segments
    .filter((segment) => segment.measured)
    .map((segment) => {
      const of = (plays: readonly BenchPlay[]) =>
        plays.map(
          (p) =>
            p.segments.find((s) => s.name === segment.name)!.numbers.gpuMs?.median ?? Number.NaN,
        )
      return { name: segment.name, ...compare(of(a), of(b), least) }
    })
}

/** Plays the rounds and writes the verdict; resolves to its text and path. */
export async function abTest(
  options: BenchOptions,
  sides: [string, string],
  rounds: number,
  least: number,
) {
  const out = measureOutput('bench-gpu')
  mkdirSync(out, { recursive: true })
  const [a, b] = sides.map((side) => engineRoot(side, options.dirtyOk).root)
  const page = options.file
  const plays = { a: [] as BenchPlay[], b: [] as BenchPlay[] }
  for (let round = 0; round < rounds; round++) {
    // The order flips every round: neither side always runs first on a cold GPU.
    for (const side of round % 2 ? (['b', 'a'] as const) : (['a', 'b'] as const)) {
      console.error(`ab: round ${round + 1}/${rounds}, ${side.toUpperCase()}`)
      plays[side].push(await play(options, page, side === 'a' ? a : b, out))
    }
  }
  const results: (Comparison & { name: string })[] = compareRounds(plays.a, plays.b, least)
  const text = abText(options, [a, b], results, least)
  const stem = join(out, `${stamp()}-ab-${options.name}`)
  writeFileSync(`${stem}.md`, text)
  writeFileSync(`${stem}.json`, JSON.stringify({ sides: [a, b], rounds, least, results }, null, 1))
  return { stem, text, results }
}

const WORDS = { gain: 'REAL GAIN', loss: 'LOSS', noise: 'noise' } as const

/** The verdict as Markdown. */
function abText(
  options: BenchOptions,
  sides: [string, string],
  results: (Comparison & { name: string })[],
  least: number,
) {
  return [
    `# A/B — ${options.name}, scenario ${options.scenario.name}`,
    '',
    `A: ${sides[0]}`,
    `B: ${sides[1]}`,
    '',
    `${results[0].rounds} rounds, the two sides alternating; the difference B − A of each round (negative: B is faster), its mean and 95 % interval. A gain or a loss needs an interval holding no zero and a mean past ${ms(least, 3)} ms; else noise.`,
    '',
    table(
      ['segment', 'A ms', 'B ms', 'B − A ms (mean)', '95 % interval ms', 'relative', 'verdict'],
      results.map((r) => [
        r.name,
        ms(r.aMs),
        ms(r.bMs),
        ms(r.meanMs, 3),
        `${ms(r.lowMs, 3)} … ${ms(r.highMs, 3)}`,
        percent(r.relative),
        WORDS[r.verdict],
      ]),
    ),
    '',
  ].join('\n')
}
