// What the cut variants of a pass say: each one's frame time and the pass's own, the difference
// between one cut and the next being the cost of the code between them. Two whole runs, one at each
// end, say how far the machine drifted meanwhile: a step smaller than that is noise.
import { ms, table } from './reportText.ts'

/** One variant's numbers, medians over its frames: `cut` null is the shader whole. */
export type Variant = { cut: string | null; frameMs: number; passMs: number; iqrMs: number }
/** The cost of the code from one cut to the next. */
export type Step = { from: string; to: string; frameMs: number; passMs: number; noise: boolean }

/** The steps of `cuts` (in shader order) from the variants measured: the whole shader first and
 *  last, then one variant a cut. The first cut's own time is the base — the launch, and what it keeps. */
export function stepsOf(cuts: readonly string[], variants: readonly Variant[]) {
  const whole = variants.filter((v) => v.cut === null)
  const by = new Map(variants.filter((v) => v.cut !== null).map((v) => [v.cut!, v]))
  const drift = Math.abs(whole[0].frameMs - whole.at(-1)!.frameMs)
  const base = (whole[0].frameMs + whole.at(-1)!.frameMs) / 2
  const wholePass = (whole[0].passMs + whole.at(-1)!.passMs) / 2
  const points = [
    ...cuts.map((c) => [c, by.get(c)!] as const),
    ['end', { frameMs: base, passMs: wholePass }] as const,
  ]
  const noise = Math.max(drift, ...variants.map((v) => v.iqrMs / 4))
  const steps: Step[] = points.map(([to, v], i) => {
    const before = i ? points[i - 1][1] : { frameMs: 0, passMs: 0 }
    const from = i ? points[i - 1][0] : 'start'
    const frameMs = v.frameMs - before.frameMs
    return {
      from,
      to,
      frameMs,
      passMs: v.passMs - before.passMs,
      noise: i > 0 && Math.abs(frameMs) < noise,
    }
  })
  return { steps, driftMs: drift, noiseMs: noise, wholeMs: base, wholePassMs: wholePass }
}

/** The dissect report, as Markdown. */
export function dissectText(
  pass: string,
  segment: string,
  result: ReturnType<typeof stepsOf>,
  variants: readonly Variant[],
) {
  const total = result.wholePassMs || 1
  return [
    `# Dissect — ${pass}, segment ${segment}`,
    '',
    `The pass takes ${ms(result.wholePassMs, 3)} ms of a ${ms(result.wholeMs)} ms frame. Each cut variant ran the shader up to a named point; a step is the difference between a cut and the one before. Drift between the two whole runs: ${ms(result.driftMs, 3)} ms; steps under ${ms(result.noiseMs, 3)} ms are noise.`,
    '',
    table(
      ['step', 'frame ms', 'pass ms', 'share of pass', ''],
      result.steps.map((s) => [
        `${s.from} → ${s.to}`,
        ms(s.frameMs, 3),
        ms(s.passMs, 3),
        `${((s.passMs / total) * 100).toFixed(0)} %`,
        s.noise ? 'noise' : '',
      ]),
    ),
    '',
    table(
      ['variant', 'frame ms', 'pass ms', 'frame middle half ms'],
      variants.map((v) => [v.cut ?? 'whole', ms(v.frameMs, 3), ms(v.passMs, 3), ms(v.iqrMs, 3)]),
    ),
    '',
  ].join('\n')
}
