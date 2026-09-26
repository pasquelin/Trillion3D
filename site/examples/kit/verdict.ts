import { ligne, type LigneResultat, type Mesure } from '../../../bench/core/measureTypes.ts';
import { failures } from './failure.ts';
import { spread } from './profile.ts';
import { statsCard } from './stats.ts';
import { ms, rate } from './statsLines.ts';
import { exampleId, kitWord } from './words.ts';

/**
 * What one part of the health check holds, named here once — the bench's baselines hold relative
 * thresholds, none of these quantities: the floor of the 60–120 Hz a frame targets, the GPU time
 * of one 60 Hz frame, one batch of shadow pages a frame (the engine's `shadowPagesPerBatch`), and
 * no page the fixed pool evicts and maps again within a part.
 */
export const BUDGETS = {
  fps: 60,
  gpuFrameMs: 1000 / 60,
  shadowPagesDrawn: 24,
  shadowPagesRefetched: 0,
};

/** The engine's counters of a drawn frame the verdict reads, `null` when not measured. */
export interface Counters {
  gpuFrameMs?: number | null;
  shadowPagesDrawn?: number | null;
  shadowPagesRefetched?: number | null;
}

/** A drawn frame of a part: when it was drawn, and its counters. */
interface Frame extends Counters {
  at: number;
}

/** The health check's verdict: `measure.ts`'s shape, and whether no line is red. */
export interface HealthVerdict extends Mesure {
  correct: boolean;
}

const measured = (frames: Frame[], key: keyof Counters) =>
  frames.map((frame) => frame[key]).filter((value): value is number => typeof value === 'number');

/** A line of a quantity held under its budget: `null` when the engine did not measure it. */
const under = (
  name: string,
  value: number | null,
  budget: number,
  print: (value: number) => string = String,
) =>
  value === null
    ? ligne({ name, motif: '—' })
    : ligne({ name, correct: value <= budget, motif: `${print(value)} ≤ ${print(budget)}` });

/** The four lines of a part, `<part>: <quantity>`: its rate from the gaps between its frames,
 *  the p95 of its GPU time and of its shadow pages drawn a frame, and the pages refetched in it. */
function partLines(part: string, frames: Frame[]): LigneResultat[] {
  const at = frames.map((frame) => frame.at),
    fps = rate(at),
    gaps = spread(at.slice(1).map((time, k) => time - at[k]));
  const gpu = spread(measured(frames, 'gpuFrameMs')),
    refetched = measured(frames, 'shadowPagesRefetched');
  const pages = refetched.length ? refetched[refetched.length - 1] - refetched[0] : null;
  return [
    {
      // One frame gives no rate: unmeasured, never a red line.
      ...(fps === null
        ? ligne({ name: `${part}: FPS`, motif: '—' })
        : ligne({
            name: `${part}: FPS`,
            correct: Math.round(fps) >= BUDGETS.fps,
            motif: `${Math.round(fps)} ≥ ${BUDGETS.fps}`,
          })),
      medianeMs: gaps?.p50 ?? null,
      p95Ms: gaps?.p95 ?? null,
      tours: frames.length,
    },
    {
      ...under(`${part}: GPU frame`, gpu?.p95 ?? null, BUDGETS.gpuFrameMs, ms),
      medianeMs: gpu?.p50 ?? null,
      p95Ms: gpu?.p95 ?? null,
    },
    under(
      `${part}: shadow pages drawn`,
      spread(measured(frames, 'shadowPagesDrawn'))?.p95 ?? null,
      BUDGETS.shadowPagesDrawn,
    ),
    under(`${part}: shadow pages refetched`, pages, BUDGETS.shadowPagesRefetched),
  ];
}

/**
 * Judges a world part by part: each frame it draws while `part()` names a part counts toward that
 * part's lines, from the counters the engine gives the frame. `refuse` records what a backend
 * refused, beside every uncaught error (`failures`): one red line; `verdict()` stops and judges.
 */
export function healthCheck(
  world: { onFrame(hook: (frame: { metrics: Counters }) => void): () => void },
  part: () => string | null,
) {
  const parts = new Map<string, Frame[]>();
  const unhook = world.onFrame(({ metrics }) => {
    const name = part();
    if (name === null) return;
    const frames = parts.get(name) ?? parts.set(name, []).get(name)!;
    const { gpuFrameMs, shadowPagesDrawn, shadowPagesRefetched } = metrics;
    frames.push({ at: performance.now(), gpuFrameMs, shadowPagesDrawn, shadowPagesRefetched });
  });
  return {
    refuse: (reason: string) => void failures.add(reason),
    verdict(): HealthVerdict {
      unhook();
      const resultats = [
        ...[...parts].flatMap(([name, frames]) => partLines(name, frames)),
        ligne({ name: 'refused', correct: !failures.size, motif: [...failures].join('; ') || '—' }),
      ];
      const [name, correct] = [exampleId(), resultats.every((line) => line.correct !== false)];
      return { name, fichier: `site/examples/${name}.html`, resultats, correct };
    },
  };
}

const TONE = { true: 'text-success', false: 'text-error', null: 'opacity-60' };

/**
 * Shows a verdict in the example's top-left corner, clear of the stats corner the controls put at
 * the bottom left — the overall verdict, then each line green, red, or dimmed when unmeasured, a
 * part named by `say(part)`, a quantity by the stats corner's words — and publishes it as
 * `window.__verdict`, where the measurer's proof reads it.
 */
export function showVerdict(verdict: HealthVerdict, say: (key: string) => string) {
  Object.assign(globalThis, { __verdict: verdict });
  statsCard('top-left')([
    [say('verdict'), verdict.correct ? '✓' : '✗', TONE[`${verdict.correct}`]],
    ...verdict.resultats.map(({ name, motif, correct }): [string, string, string] => {
      const [part, quantity] = name.split(': ');
      const label = quantity ? `${say(part)} · ${kitWord('stats', quantity, quantity)}` : say(part);
      return [label, motif ?? '', TONE[`${correct}`]];
    }),
  ]);
}
