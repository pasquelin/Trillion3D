// `run.ts <page> --ab <checkout A> <checkout B>`: is B faster than A, or is it noise? The same page
// (the bench's own, so the two sides play one scene), the same scenario, plays that alternate the two
// engines round after round — A B, B A, A B… — so what the machine drifts by between rounds falls on
// both. Each play is a fresh process; each round's difference is B − A; the verdict reads its
// interval (`abStats.ts`), on the frame's GPU time of every measured segment.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../../core/paths.ts'
import { compare, type Comparison } from './abStats.ts'
import { childArgs } from '../runs/childArgs.ts'
import { stamp, type BenchOptions } from '../runs/options.ts'
import type { BenchPlay } from '../runs/play.ts'
import { playChild } from '../runs/playChild.ts'
import { engineRoot } from '../page/engineRoot.ts'
import { ms, percent } from './reportText.ts'
import { table } from '../../core/table.ts'

/** One play of `root`'s engine on `page`: its numbers. A verdict reads times, so no image is taken, none left behind
 *  — unless `report` names where the play's images go (`abImages`). */
function play(options: BenchOptions, page: string, root: string, report: string, images = false) {
  return playChild(
    [
      page,
      '--scenario',
      options.scenarioArg,
      '--engine',
      root,
      ...childArgs(process.argv.slice(2)),
      ...(images ? [] : ['--no-capture']),
    ],
    {},
    report,
    `BENCH_AB: a play of ${root}`,
    options.timeoutS,
  )
}

/** A segment's comparison, or why it has none: a verdict lost on one segment is not the others'. */
type SegmentResult = (Comparison & { name: string }) | { name: string; failed: string }

/** The segments' comparisons of the rounds `a` and `b` (plays of A and of B, in round order). */
function compareRounds(a: readonly BenchPlay[], b: readonly BenchPlay[], least: number) {
  return a[0].segments
    .filter((segment) => segment.measured)
    .filter((segment) =>
      // A held image draws nothing to time: no round of either side has a number, no row.
      [...a, ...b].some((p) =>
        Number.isFinite(p.segments.find((s) => s.name === segment.name)?.numbers.gpuMs?.median),
      ),
    )
    .map((segment): SegmentResult => {
      const of = (plays: readonly BenchPlay[]) =>
        plays.map(
          (p) =>
            p.segments.find((s) => s.name === segment.name)?.numbers.gpuMs?.median ?? Number.NaN,
        )
      try {
        return { name: segment.name, ...compare(of(a), of(b), least) }
      } catch (error) {
        return { name: segment.name, failed: (error as Error).message }
      }
    })
}

/** Plays the rounds and writes the verdict; resolves to its text and path. */
export async function abTest(
  options: BenchOptions,
  sides: [string, string],
  rounds: number,
  least: number,
) {
  if (!options.scenario.segments.some((segment) => segment.measure !== false))
    throw new Error(`BENCH_AB: the scenario ${options.scenario.name} measures no segment`)
  const out = measureOutput('bench-gpu')
  mkdirSync(out, { recursive: true })
  const [a, b] = sides.map((side) => engineRoot(side, options.dirtyOk).root)
  const page = options.file
  const plays = { a: [] as BenchPlay[], b: [] as BenchPlay[] }
  // A play that fails ends the rounds, not the verdict: the rounds both sides finished are kept.
  let stopped = ''
  rounds: for (let round = 0; round < rounds; round++) {
    // The order flips every round: neither side always runs first on a cold GPU.
    for (const side of round % 2 ? (['b', 'a'] as const) : (['a', 'b'] as const)) {
      console.error(`ab: round ${round + 1}/${rounds}, ${side.toUpperCase()}`)
      try {
        plays[side].push(
          await play(
            options,
            page,
            side === 'a' ? a : b,
            join(out, `${stamp()}-ab-${side}${round + 1}.json`),
          ),
        )
      } catch (error) {
        stopped = `round ${round + 1} stopped: ${(error as Error).message}`
        break rounds
      }
    }
  }
  const done = Math.min(plays.a.length, plays.b.length)
  if (done < 2) throw new Error(`BENCH_AB: ${stopped || 'fewer than two rounds'}`)
  plays.a.length = plays.b.length = done
  const results = compareRounds(plays.a, plays.b, least)
  const text = abText(options, [a, b], results, done, least, stopped)
  const stem = join(out, `${stamp()}-ab-${options.name}`)
  writeFileSync(`${stem}.md`, text)
  writeFileSync(
    `${stem}.json`,
    JSON.stringify({ sides: [a, b], rounds: done, stopped, least, results }, null, 1),
  )
  return { stem, text, results }
}

const WORDS = { gain: 'REAL GAIN', loss: 'LOSS', noise: 'noise' } as const

/** The verdict as Markdown. */
function abText(
  options: BenchOptions,
  sides: [string, string],
  results: SegmentResult[],
  rounds: number,
  least: number,
  stopped: string,
) {
  return [
    `# A/B — ${options.name}, scenario ${options.scenario.name}`,
    '',
    `A: ${sides[0]}`,
    `B: ${sides[1]}`,
    ...(stopped ? [`STOPPED EARLY — ${stopped}`, ''] : []),
    `${rounds} rounds, the two sides alternating; the difference B − A of each round (negative: B is faster), its mean and 95 % interval. A gain or a loss needs an interval holding no zero and a mean past ${ms(least, 3)} ms; else noise.`,
    '',
    table(
      ['segment', 'A ms', 'B ms', 'B − A ms (mean)', '95 % interval ms', 'relative', 'verdict'],
      results.map((r) =>
        'failed' in r
          ? [r.name, '—', '—', '—', '—', '—', `NO VERDICT: ${r.failed}`]
          : [
              r.name,
              ms(r.aMs),
              ms(r.bMs),
              ms(r.meanMs, 3),
              `${ms(r.lowMs, 3)} … ${ms(r.highMs, 3)}`,
              percent(r.relative),
              WORDS[r.verdict],
            ],
      ),
    ),
    '',
  ].join('\n')
}

/**
 * `--ab-images`: one play of each engine, its images kept — the same scenario, the clock frozen while the
 * pages load (`settleLoading`) and the same frames asked for on both sides, so the two sides' images
 * are the same views, to the extent the engines are deterministic (a noise or a dither the two seed alike) — in `<dir>/a` and `<dir>/b`, under the same names. The pairs are read by
 * `.mesure/chef/abImages.ts`. The frame times of the two plays are listed, one play each: a gain
 * is read by the rounds (`abTest`), not by these.
 */
export async function abImages(options: BenchOptions, sides: [string, string]) {
  if (options.noCapture || options.cpuProfile)
    throw new Error('BENCH_AB: --ab-images takes images: not with --no-capture or --cpu-profile')
  if (!options.scenario.segments.some((segment) => segment.capture))
    throw new Error(`BENCH_AB: the scenario ${options.scenario.name} captures no segment`)
  const [a, b] = sides.map((side) => engineRoot(side, options.dirtyOk).root)
  const dir = join(measureOutput('bench-gpu'), `${stamp()}-ab-images-${options.name}`)
  const plays = new Map<string, BenchPlay>()
  for (const [side, root] of [
    ['a', a],
    ['b', b],
  ] as const) {
    mkdirSync(join(dir, side), { recursive: true })
    console.error(`ab-images: ${side.toUpperCase()}`)
    // The images are named after the report: `play-<segment>.png` in the side's folder, the same on both.
    const done = await play(options, options.file, root, join(dir, side, 'play.json'), true)
    plays.set(side, done)
  }
  const rows = plays.get('a')!.segments.map((segment) => {
    const other = plays.get('b')!.segments.find((s) => s.name === segment.name)
    return [
      segment.name,
      ms(segment.numbers.gpuMs?.median ?? Number.NaN),
      ms(other?.numbers.gpuMs?.median ?? Number.NaN),
    ]
  })
  const text = [
    `# A/B images — ${options.name}, scenario ${options.scenario.name}`,
    '',
    `A: ${a}`,
    `B: ${b}`,
    '',
    table(['segment', 'A ms', 'B ms'], rows),
    '',
    `Images: ${dir}/a and ${dir}/b. Compare: node .mesure/chef/abImages.ts ${dir}/a ${dir}/b`,
    '',
  ].join('\n')
  writeFileSync(`${dir}/ab-images.md`, text)
  return { dir, text }
}
