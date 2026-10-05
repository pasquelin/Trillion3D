// The clock of `mesure`: one sample repeats the call until it lasts 50 µs, with no `await` inside
// the timed window; warm-up by count AND by time; the witness and the calculation interleaved, in
// an order that alternates every round, so neither always runs first on a cold cache.
import v8 from 'node:v8';
import vm from 'node:vm';
import type { Stats } from '../../site/examples/kit/measureTypes.ts';

export interface Reglages {
  chauffe: number;
  tours: number;
  budgetMs: number;
}

/** Shortest timed sample. `process.hrtime.bigint` ticks every 41.7 ns on this machine and an
 *  `await` alone costs ~125 ns: a single 0.2 µs call timed alone read the harness, ±20 %. Fifty
 *  microseconds hold both clock reads under 0.2 % of the sample. */
const ECHANTILLON_NS = 50_000;
/** Floors no caller lowers. Medians of 3–5 samples taken during tier-up spread up to 474 % run to
 *  run (core-math, hierarchy); ten samples of 50 µs and 50 ms of warm-up let TurboFan land first. */
const CHAUFFE_MIN = 10;
const CHAUFFE_MIN_MS = 50;
export const TOURS_MIN = 15;
/** Ceilings that keep a stopped or coarse clock from looping forever: no call is cheaper than
 *  50 µs / 65 536 = 0.76 ns, and 2 000 warm-up rounds of 50 µs already pass `CHAUFFE_MIN_MS`. */
const REPS_MAX = 65_536;
const CHAUFFE_MAX = 2_000;

// A full collection before each timed series, outside every sample: the garbage one case leaves
// is not billed to the next. `--expose-gc` set at run time, so no script has to pass it.
v8.setFlagsFromString('--expose-gc');
const collecte = vm.runInNewContext('gc') as () => void;

/** Where each call's result goes: a store the compiler cannot drop, so neither is the call. */
const puits: { valeur?: unknown } = {};

const estPromesse = (v: unknown): v is PromiseLike<unknown> =>
  typeof (v as PromiseLike<unknown> | null)?.then === 'function';

interface Serie {
  calcul: (input: unknown) => unknown;
  input: unknown;
  asynchrone: boolean;
  reps: number;
  durees: number[];
}

/** One sample of `reps` calls, in nanoseconds. A synchronous calculation is timed synchronously. */
function echantillonSync({ calcul, input, reps }: Serie) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) puits.valeur = calcul(input);
  return Number(process.hrtime.bigint() - t0);
}

async function echantillonAsync({ calcul, input, reps }: Serie) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) puits.valeur = await calcul(input);
  return Number(process.hrtime.bigint() - t0);
}

const echantillon = (s: Serie) => (s.asynchrone ? echantillonAsync(s) : echantillonSync(s));

/** Grows `reps` until one sample lasts `ECHANTILLON_NS`, or reaches `REPS_MAX`. */
async function calibre(s: Serie) {
  while (s.reps < REPS_MAX) {
    const ns = await echantillon(s);
    if (ns >= ECHANTILLON_NS) return;
    const voulu = ns > 0 ? Math.ceil((s.reps * 1.25 * ECHANTILLON_NS) / ns) : s.reps * 64;
    s.reps = Math.min(voulu, REPS_MAX);
  }
}

async function serie(calcul: (input: unknown) => unknown, input: unknown): Promise<Serie> {
  const premier = calcul(input);
  const asynchrone = estPromesse(premier);
  puits.valeur = asynchrone ? await premier : premier;
  return { calcul, input, asynchrone, reps: 1, durees: [] };
}

const mediane = (t: number[]) => {
  const milieu = t.length >> 1;
  return t.length % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
};

export function stats(durees: number[]): Stats {
  const t = durees.slice().sort((a, b) => a - b);
  const n = t.length;
  const i95 = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  return { medianeMs: mediane(t), p95Ms: t[i95], minMs: t[0], tours: n };
}

/** The median of the per-round quotients calculation / witness, minus one: each quotient reads two
 *  samples taken back to back, so a load that drifts across the series cancels out of it. `null`
 *  when no round has a finite quotient (a stopped clock). */
function ecartApparie(calcul: number[], temoin: number[]) {
  const q = calcul.map((c, i) => c / temoin[i]).filter(Number.isFinite);
  return q.length ? mediane(q.sort((a, b) => a - b)) - 1 : null;
}

const depuisMs = (debut: bigint) => Number(process.hrtime.bigint() - debut) / 1e6;

/**
 * The statistics of a calculation on one input, and of its witness when there is one, each per
 * call, with their paired gap (`ecartApparie`). Warm-up: at least `max(chauffe, CHAUFFE_MIN)` samples and `CHAUFFE_MIN_MS`; the repeat count
 * is calibrated before and after it. Timed rounds: one sample of each side, the order alternating,
 * until `tours`, or the budget once `TOURS_MIN` rounds are in (the budget doubles with a witness:
 * each side keeps its own, as before).
 */
export async function chronometre(
  calcul: (input: unknown) => unknown,
  input: unknown,
  { chauffe, tours, budgetMs }: Reglages,
  temoin?: (input: unknown) => unknown,
): Promise<{ calcul: Stats; temoin: Stats | null; ecartTemoin: number | null }> {
  const series = [await serie(calcul, input)];
  if (temoin) series.unshift(await serie(temoin, input));
  for (const s of series) await calibre(s);
  const chauffeDebut = process.hrtime.bigint();
  const chauffeMin = Math.max(chauffe, CHAUFFE_MIN);
  for (
    let i = 0;
    i < chauffeMin || (i < CHAUFFE_MAX && depuisMs(chauffeDebut) < CHAUFFE_MIN_MS);
    i++
  )
    for (const s of series) await echantillon(s);
  for (const s of series) await calibre(s);
  collecte();

  const voulus = Math.max(tours, TOURS_MIN);
  const budget = budgetMs * series.length;
  const debut = process.hrtime.bigint();
  for (let tour = 0; tour < voulus; tour++) {
    for (let k = 0; k < series.length; k++) {
      const s = series[tour % 2 ? series.length - 1 - k : k];
      s.durees.push((await echantillon(s)) / s.reps / 1e6);
    }
    if (tour + 1 >= TOURS_MIN && depuisMs(debut) > budget) break;
  }
  const mesuree = series[series.length - 1].durees,
    reference = series[0].durees;
  return temoin
    ? {
        calcul: stats(mesuree),
        temoin: stats(reference),
        ecartTemoin: ecartApparie(mesuree, reference),
      }
    : { calcul: stats(mesuree), temoin: null, ecartTemoin: null };
}
