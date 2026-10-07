import { resultRow, type Measurement, type ResultRow } from './measureTypes.ts'
import { failures } from './failure.ts'
import { spread } from './profile.ts'
import { statsCard } from './stats.ts'
import { rate } from './statsLines.ts'
import { ms } from './statUnit.ts'
import { exampleId, kitWord } from './words.ts'

/**
 * What one part of the health check holds, named here once — the bench's baselines hold relative
 * thresholds, none of these quantities: the floor of the 60–120 Hz a frame targets, the GPU time
 * of one 60 Hz frame, and the shadows within 2 ms of GPU.
 */
const BUDGETS = { fps: 60, gpuFrameMs: 1000 / 60, gpuShadowsMs: 2 }

/** The budgets the engine does not meet yet, each with the open issue that delivers it: its line
 *  is `flagged`: red, `until #<issue>`, and counts against no verdict. Its pull request drops it. */
const UNTIL: Partial<Record<keyof typeof BUDGETS, number>> = { gpuShadowsMs: 525 }

const flagged = ({ name, motif }: ResultRow) =>
  name !== 'refused' && /, until #\d+$/.test(motif ?? '')

/** The engine's counters of a drawn frame the verdict reads, `null` when not measured. */
interface Counters {
  gpuFrameMs?: number | null
  gpuShadowsMs?: number | null
}

/** A drawn frame of a part: when it was drawn, and its counters. */
type Frame = Counters & { at: number }

/** The health check's verdict: `measure.ts`'s shape, and whether no line is red. */
type HealthVerdict = Measurement & { correct: boolean }

const measured = (frames: Frame[], key: keyof Counters) =>
  frames.map((frame) => frame[key]).filter((value): value is number => typeof value === 'number')

/** A line of a quantity: held under its budget in ms, `until #<issue>` when `UNTIL` flags it,
 *  `null` when the engine did not measure it; its median and p95 kept. */
function line(name: string, values: number[], key: keyof typeof BUDGETS) {
  const value = spread(values),
    until = UNTIL[key] ? `, until #${UNTIL[key]}` : ''
  const row = !value
    ? resultRow({ name, motif: '—' })
    : resultRow({
        name,
        correct: value.p95 <= BUDGETS[key],
        motif: `${ms(value.p95)} ≤ ${ms(BUDGETS[key])}${until}`,
      })
  return { ...row, medianeMs: value?.p50 ?? null, p95Ms: value?.p95 ?? null }
}

/** The lines of a part, `<part>: <quantity>`: its rate from the gaps between its frames, the p95
 *  of its GPU and shadow times. */
function partLines(part: string, frames: Frame[]): ResultRow[] {
  const at = frames.map((frame) => frame.at),
    gaps = spread(at.slice(1).map((time, k) => time - at[k])),
    [fps, mean] = [Math.round(1000 / (gaps?.p50 ?? NaN)), Math.round(rate(at) ?? 0)]
  return [
    {
      ...resultRow({ name: `${part}: FPS`, motif: '—' }),
      // The median gap judges, a late frame is no slow part; one frame gives no rate, no red line.
      ...(gaps && { correct: fps >= BUDGETS.fps, motif: `${fps} ≥ ${BUDGETS.fps}, mean ${mean}` }),
      medianeMs: gaps?.p50 ?? null,
      p95Ms: gaps?.p95 ?? null,
      tours: frames.length,
    },
    line(`${part}: GPU frame`, measured(frames, 'gpuFrameMs'), 'gpuFrameMs'),
    line(`${part}: GPU shadows`, measured(frames, 'gpuShadowsMs'), 'gpuShadowsMs'),
  ]
}

/**
 * Judges a world part by part: each frame it draws while `part()` names a part counts toward that
 * part's lines, from the counters the engine gives the frame. `refuse(reason, true)` records a
 * limit the backend documents, a neutral `refused: <renderer>` line; any other refusal joins the
 * uncaught errors (`failures`) on the red `refused` line. `verdict()` stops and judges.
 */
export function healthCheck(
  world: {
    onFrame(hook: (frame: { metrics: Counters }) => void): () => void
    renderer?: string | null
  },
  part: () => string | null,
) {
  const parts = new Map<string, Frame[]>(),
    byDesign = new Set<string>()
  const unhook = world.onFrame(({ metrics }) => {
    const name = part()
    if (name === null) return
    const frames = parts.get(name) ?? parts.set(name, []).get(name)!
    const { gpuFrameMs, gpuShadowsMs } = metrics
    frames.push({ at: performance.now(), gpuFrameMs, gpuShadowsMs })
  })
  return {
    refuse: (reason: string, documented = false) =>
      void (documented ? byDesign : failures).add(reason),
    verdict(): HealthVerdict {
      unhook()
      const resultats = [
        ...[...parts].flatMap(([name, frames]) => partLines(name, frames)),
        resultRow({ name: `refused: ${world.renderer}`, motif: [...byDesign].join('; ') || '—' }),
        resultRow({
          name: 'refused',
          correct: !failures.size,
          motif: [...failures].join('; ') || '—',
        }),
      ]
      const correct = resultats.every((line) => line.correct !== false || flagged(line)),
        name = exampleId()
      return { name, fichier: `site/examples/${name}.html`, resultats, correct }
    },
  }
}

const TONE = { true: 'text-success', false: 'text-error', null: 'opacity-60' }

/**
 * Shows a verdict in the example's top-left corner, clear of the stats corner the controls put at
 * the bottom left — the overall verdict, then each line green, red, or dimmed when unmeasured, a
 * part named by `say(part)`, a quantity by the stats corner's words — and publishes it as
 * `window.__verdict`, where the proof reads it.
 */
export function showVerdict(verdict: HealthVerdict, say: (key: string) => string) {
  Object.assign(globalThis, { __verdict: verdict })
  statsCard('top-left')([
    [verdict.correct ? '✓' : '✗', '', TONE[`${verdict.correct}`]],
    ...verdict.resultats.map(({ name, motif, correct }): [string, string, string] => {
      const [part, quantity] = name.split(': ')
      const label = quantity ? `${say(part)} · ${kitWord('stats', quantity, quantity)}` : say(part)
      return [label, motif ?? '', TONE[`${correct}`]]
    }),
  ])
}
