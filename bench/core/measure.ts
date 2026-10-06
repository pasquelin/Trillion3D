// Absolute measurement of an engine calculation, on named cases, against an oracle.
// This file only measures and compares: table, fragments, baselines and path
// checking of cited files are managed by `report.ts`.
import { chronometre, type Reglages } from './chrono.ts';
import { gap } from './diff.ts';
import type { Counter } from './ulp.ts';
import {
  resultRow,
  type Measurement,
  type ResultRow,
} from '../../site/examples/kit/measureTypes.ts';

/** One named input to measure, or to verify only when `measure` is `false`. */
export interface MeasureCase<Entree = unknown> {
  name: string;
  input: Entree;
  size?: number | null;
  measure?: boolean;
}

interface Verdict {
  correct: boolean | null;
  difference: string | null;
  motif: string | null;
}

/** Parameters of `measure`: the calculation, its oracle, and the settings it measures under. */
export interface MeasureParams<Entree = unknown, Sortie = unknown> {
  name: string;
  fichier: string | string[];
  cas: MeasureCase<Entree>[];
  options?: Partial<Reglages>;
  calculation: (input: Entree) => Sortie | Promise<Sortie>;
  expected?: (input: Entree) => Sortie | Promise<Sortie>;
  temoin?: (input: Entree) => unknown;
  differences?: (ref: Sortie, obt: Sortie, path: string) => Counter;
  /** Reads, untimed, what a call left — its result or the state it wrote — for the oracle check:
   *  the timed call then runs the engine alone, with no copy or allocation of its output. */
  lecture?: (input: Entree, sortie: Sortie) => unknown;
  motif?: string | null;
}

/**
 * `f` over every element of a list, into an array the returned function keeps from call to call:
 * the timed call runs the measured function alone, where `list.map` allocated and filled a new
 * array each time — at 2 000 elements, most of what a 20 µs line read. A side's result is read
 * before that side is called again, so reusing its array changes no comparison.
 */
export function parElement<E, R>(f: (element: E, index: number) => R) {
  const sortie: R[] = [];
  return (list: readonly E[]) => {
    sortie.length = list.length;
    for (let i = 0; i < list.length; i++) sortie[i] = f(list[i], i);
    return sortie;
  };
}

export function xorshiftRandom(depart: number) {
  let state = depart >>> 0 || 0x9e3779b9;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 4294967296;
  };
}

const countText = (c: Counter) => `${c.count} discrepancy(ies), ${c.ulpMax} ULP at most`;

type VerifyConf<Entree, Sortie> = Omit<MeasureParams<Entree, Sortie>, 'name' | 'fichier' | 'cas'>;

/**
 * Compares a case to its oracle. Without `differences`, equality is strict bitwise; with, the
 * count of discrepancies is published as is — the benchmark then measures a REFUSED candidate and quantifies what it
 * displaces, instead of demanding equality that does not apply. The caller's `motif` is always
 * kept: without an oracle it says where correctness is held, with one it says what the comparison
 * leaves out; never silence.
 */
async function verifyCase<Entree, Sortie>(
  item: MeasureCase<Entree>,
  { calculation, expected, differences, lecture, motif }: VerifyConf<Entree, Sortie>,
): Promise<Verdict> {
  if (!expected) return { correct: null, difference: null, motif: motif ?? null };
  const lit = (sortie: Sortie) => (lecture ? lecture(item.input, sortie) : sortie);
  const ref = lit(await expected(item.input));
  const obt = lit(await calculation(item.input));
  if (!differences) {
    const diff = gap(ref, obt, item.name);
    return { correct: diff === null, difference: diff, motif: motif ?? null };
  }
  const count = countText(differences(ref as Sortie, obt as Sortie, item.name));
  return { correct: null, difference: null, motif: motif ? `${count} ; ${motif}` : count };
}

/**
 * Absolute measurement of a calculation on a set of named cases, each verified against `expected`.
 * `fichier` is the measured path, or list of paths; `measure: false` on a case verifies it without timing.
 * `temoin` is another calculation of the same thing, timed under the same settings and interleaved
 * with it: its statistics go under `temoin`, and `ecartTemoin` is the median of the per-round
 * quotients calculation / witness, minus one (`null` without) — the one statistic the `vs witness`
 * column prints and the duel gates read.
 */
export async function measure<Entree = unknown, Sortie = unknown>({
  name,
  fichier: file,
  cas,
  options = {},
  ...conf
}: MeasureParams<Entree, Sortie>): Promise<Measurement> {
  const reglages: Reglages = { warmup: 20, tours: 200, budgetMs: 1000, ...options };
  const results: ResultRow[] = [];

  for (const item of cas) {
    const verdict = await verifyCase(item, conf);

    if (item.measure === false) {
      results.push(resultRow({ ...verdict, name: item.name, size: item.size ?? null }));
      continue;
    }

    const {
      calculation: s,
      temoin: t,
      ecartTemoin: gapWitness,
    } = await chronometre(
      conf.calculation as (input: unknown) => unknown,
      item.input,
      reglages,
      conf.temoin as ((input: unknown) => unknown) | undefined,
    );
    const taille = item.size ?? null;
    results.push({
      name: item.name,
      size: taille,
      ...s,
      nsParElement: taille !== null && taille > 0 ? (s.medianeMs * 1e6) / taille : null,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      temoin: t,
      ecartTemoin: gapWitness,
      ...verdict,
    });
  }
  return { name, fichier: file, resultats: results };
}
