import type { LigneResultat, Mesure } from '../../../bench/core/measureTypes.ts';
import { spread } from './profile.ts';
import { statsCard } from './stats.ts';
import { kitWord } from './words.ts';

/**
 * What one part of the health check holds, named here once — the bench's baselines hold relative
 * thresholds, none of these quantities: the floor of the 60–120 Hz a frame targets, the GPU time
 * of one 60 Hz frame, one batch of shadow pages a frame (the engine's `shadowPagesPerBatch`), and
 * no page the fixed pool evicts and maps again while a view stands still in it.
 */
const BUDGETS = { fps: 60, gpuFrameMs: 1000 / 60, shadowPagesDrawn: 24, shadowPagesRefetched: 0 };

/** The engine's counters of a drawn frame the verdict reads, `null` when not measured. */
interface Counters {
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

/** A verdict line in `measure.ts`'s row shape: `correct` green, red, or `null` unmeasured. */
function row(
  name: string,
  correct: boolean | null,
  motif: string,
  ms: { p50: number; p95: number } | null = null,
  tours = 0,
): LigneResultat {
  return {
    name,
    size: null,
    medianeMs: ms?.p50 ?? null,
    p95Ms: ms?.p95 ?? null,
    minMs: null,
    nsParElement: null,
    tours,
    opsParSec: null,
    temoin: null,
    ecartTemoin: null,
    correct,
    difference: null,
    motif,
  };
}

const measured = (frames: Frame[], key: keyof Counters) =>
  frames.map((frame) => frame[key]).filter((value): value is number => typeof value === 'number');

/** The four lines of a part, `<part>: <quantity>`: its rate from the gaps between its frames,
 *  the p95 of its GPU time and of its shadow pages drawn a frame, and the pages refetched in it. */
function partLines(part: string, frames: Frame[]): LigneResultat[] {
  const at = frames.map((frame) => frame.at),
    gaps = at.slice(1).map((time, k) => time - at[k]);
  const fps = gaps.length ? (gaps.length * 1000) / (at[at.length - 1] - at[0]) : 0;
  const gpu = spread(measured(frames, 'gpuFrameMs')),
    drawn = spread(measured(frames, 'shadowPagesDrawn')),
    refetched = measured(frames, 'shadowPagesRefetched');
  const pages = refetched.length ? refetched[refetched.length - 1] - refetched[0] : null;
  const { fps: floor, gpuFrameMs, shadowPagesDrawn, shadowPagesRefetched } = BUDGETS;
  return [
    row(`${part}: FPS`, fps >= floor, `${Math.round(fps)} ≥ ${floor}`, spread(gaps), frames.length),
    gpu
      ? row(
          `${part}: GPU frame`,
          gpu.p95 <= gpuFrameMs,
          `${gpu.p95.toFixed(2)} ms ≤ ${gpuFrameMs.toFixed(2)}`,
          gpu,
        )
      : row(`${part}: GPU frame`, null, '—'),
    drawn
      ? row(
          `${part}: shadow pages drawn`,
          drawn.p95 <= shadowPagesDrawn,
          `${drawn.p95} ≤ ${shadowPagesDrawn}`,
        )
      : row(`${part}: shadow pages drawn`, null, '—'),
    pages === null
      ? row(`${part}: shadow pages refetched`, null, '—')
      : row(
          `${part}: shadow pages refetched`,
          pages <= shadowPagesRefetched,
          `${pages} ≤ ${shadowPagesRefetched}`,
        ),
  ];
}

/**
 * Judges a world part by part: each frame it draws while `part()` names a part counts toward that
 * part's lines, from the counters the engine gives the frame. `refuse` records what a backend
 * refused, with its reason — one red line, never hidden; `verdict()` judges what was drawn so far.
 */
export function healthCheck(
  world: { onFrame(hook: (frame: { metrics: Counters }) => void): unknown },
  part: () => string | null,
) {
  const parts = new Map<string, Frame[]>(),
    refused: string[] = [];
  world.onFrame(({ metrics }) => {
    const name = part();
    if (name === null) return;
    if (!parts.has(name)) parts.set(name, []);
    const { gpuFrameMs, shadowPagesDrawn, shadowPagesRefetched } = metrics;
    parts
      .get(name)
      ?.push({ at: performance.now(), gpuFrameMs, shadowPagesDrawn, shadowPagesRefetched });
  });
  return {
    refuse: (reason: string) => void refused.push(reason),
    verdict(): HealthVerdict {
      const resultats = [
        ...[...parts].flatMap(([name, frames]) => partLines(name, frames)),
        row('refused', refused.length === 0, refused.join('; ') || '—'),
      ];
      const correct = resultats.every((line) => line.correct !== false);
      return {
        name: 'health-check',
        fichier: 'site/examples/health-check.html',
        resultats,
        correct,
      };
    },
  };
}

const TONE = { true: 'text-success', false: 'text-error', null: 'opacity-60' };

/**
 * Shows a verdict in the example's corner — the overall verdict, then each line green, red, or
 * dimmed when unmeasured, a part named by `say(part)`, a quantity by the stats corner's words — and
 * publishes it as `window.__verdict`, where the measurer's proof reads it.
 */
export function showVerdict(verdict: HealthVerdict, say: (key: string) => string) {
  Object.assign(globalThis, { __verdict: verdict });
  statsCard()([
    [say('verdict'), verdict.correct ? '✓' : '✗', TONE[`${verdict.correct}`]],
    ...verdict.resultats.map(({ name, motif, correct }): [string, string, string] => {
      const [part, quantity] = name.split(': ');
      const label = quantity ? `${say(part)} · ${kitWord('stats', quantity, quantity)}` : say(part);
      return [label, motif ?? '', TONE[`${correct}`]];
    }),
  ]);
}
