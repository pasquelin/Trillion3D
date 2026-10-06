// Performance baselines of a domain: `.measure/baselines/<domain>.json`, outside repository because
// timing is only valid on the machine that recorded it. Each row is retrieved by the key pair
// measurement/case, never by its source file: multiple benchmarks measure the same file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RACINE, baselinePath, dossierBaselines } from './paths.ts';
import type { Measurement } from '../../site/examples/kit/measureTypes.ts';

/** One stored baseline row, keyed by measurement/case pair. */
interface BaselineRow {
  cle: string;
  size: number | null;
  medianeMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  nsParElement: number | null;
}

/** A domain baseline file, `.measure/baselines/<domain>.json`. */
export interface BaselineFile {
  version: 3;
  domaine: string;
  commit: string | null;
  date: string;
  machine: string;
  node: string;
  resultats: BaselineRow[];
}

/** The key of a baseline row: measurement name and case name. */
export const rowKey = (measure: string, cas: string) => `${measure} | ${cas}`;

let commitMemoire: string | null | undefined;

/** Current commit, retrieved once per process: `baseline-save` stores thirty-nine. */
export function commitCourant() {
  if (commitMemoire === undefined) {
    try {
      commitMemoire = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: RACINE,
        encoding: 'utf8',
      }).trim();
    } catch {
      commitMemoire = null;
    }
  }
  return commitMemoire;
}

/** Loads a domain baseline, or `null` if the machine has not stored one yet. */
export function chargeBaseline(domaine: string): BaselineFile | null {
  const path = baselinePath(domaine);
  if (!existsSync(path)) return null;
  try {
    const lue = JSON.parse(readFileSync(path, 'utf8')) as BaselineFile;
    return lue?.version === 3 ? lue : null;
  } catch {
    return null;
  }
}

/** Saves a domain baseline from the fragment that `rapport()` wrote. */
export function sauveBaseline(domaine: string, measurements: Measurement[]) {
  const results: BaselineRow[] = measurements.flatMap((m) =>
    m.resultats.map((r) => ({
      cle: rowKey(m.name, r.name),
      size: r.size,
      medianeMs: r.medianeMs,
      p95Ms: r.p95Ms,
      minMs: r.minMs,
      nsParElement: r.nsParElement ?? null,
    })),
  );
  mkdirSync(dossierBaselines, { recursive: true });
  writeFileSync(
    baselinePath(domaine),
    JSON.stringify(
      {
        version: 3,
        domaine,
        commit: commitCourant(),
        date: new Date().toISOString(),
        machine: `${process.platform}/${process.arch}`,
        node: process.version,
        resultats: results,
      },
      null,
      2,
    ) + '\n',
  );
  return results.length;
}

/**
 * The two regression thresholds, written HERE and nowhere else: a row's status icon and
 * a report's conclusion read the exact same rule, avoiding self-contradictions.
 */
export const WARNING_THRESHOLD = 0.1;
export const FAILURE_THRESHOLD = 0.25;

/** A median relative to a reference median — baseline or witness; `null` without one, never `0`. */
export const relativeGap = (medianMs: number | null, referenceMs: number | null | undefined) =>
  referenceMs && medianMs !== null ? (medianMs - referenceMs) / referenceMs : null;

/** Regression thresholds a caller may tighten. */
export interface Seuils {
  warningThreshold?: number;
  failureThreshold?: number;
}

/** The level of a discrepancy: `absent` if no baseline, then `ok`, `warning`, and `failure`. */
export type GapLevel = 'absent' | 'ok' | 'warning' | 'failure';

export function gapLevel(gap: number | null | undefined, options: Seuils = {}): GapLevel {
  const { warningThreshold = WARNING_THRESHOLD, failureThreshold = FAILURE_THRESHOLD } = options;
  if (gap === null || gap === undefined || Number.isNaN(gap)) return 'absent';
  if (gap > failureThreshold) return 'failure';
  if (gap > warningThreshold) return 'warning';
  return 'ok';
}

/** A row bearing the discrepancy a batch verdict is computed from. */
export interface RowWithBaselineGap {
  name: string;
  ecartBaseline: number | null;
}

/** One case counted toward a batch verdict, named and with its discrepancy against the baseline. */
interface GapCase {
  name: string;
  gap: number | null;
}

/** The verdict of a batch of cases compared against a baseline. */
export interface Tally extends Required<Seuils> {
  verdict: GapLevel;
  compares: number;
  regressions: GapCase[];
  warnings: GapCase[];
}

/**
 * The verdict of a measurement batch, from the discrepancies that `report.ts` already calculated against the
 * baseline. It does NOT recalculate: a discrepancy calculated twice can diverge.
 * `absent` when no case has a baseline — which is not the same thing as "nothing slowed down".
 */
export function compareBaseline(results: RowWithBaselineGap[], options: Seuils = {}): Tally {
  const { warningThreshold = WARNING_THRESHOLD, failureThreshold = FAILURE_THRESHOLD } = options;
  const seuils = { warningThreshold, failureThreshold };
  const warnings: GapCase[] = [],
    regressions: GapCase[] = [];
  let compares = 0;
  for (const r of results) {
    const level = gapLevel(r.ecartBaseline, seuils);
    if (level === 'absent') continue;
    compares++;
    const cas = { name: r.name, gap: r.ecartBaseline };
    if (level === 'failure') regressions.push(cas);
    else if (level === 'warning') warnings.push(cas);
  }
  const verdict: GapLevel = !compares
    ? 'absent'
    : regressions.length
      ? 'failure'
      : warnings.length
        ? 'warning'
        : 'ok';
  return { verdict, compares, regressions, warnings, ...seuils };
}
