// Benchmark rendering: path checking of cited files, accuracy assertion, comparison with
// domain baseline, fragment stored in `.measure/perf/` and row printed to console.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FAILURE_THRESHOLD,
  chargeBaseline,
  rowKey,
  compareBaseline,
  relativeGap,
} from './baseline.ts';
import { FRAGMENTS, RACINE, fragmentPath } from './paths.ts';
import { ligneMd } from './table.ts';
import type { Measurement } from '../../site/examples/kit/measureTypes.ts';

/** A domain fragment deposited under `.measure/perf/`, for the report's two readers. */
export interface Fragment {
  version: 3;
  domaine: string;
  mesures: Measurement[];
}

/** Measured paths must exist: a row citing a dead file measures nothing. */
function verifyFiles(measurements: Measurement[]) {
  for (const m of measurements) {
    const chemins = Array.isArray(m.fichier) ? m.fichier : [m.fichier];
    for (const path of chemins)
      if (!existsSync(join(RACINE, path)))
        throw new Error(`Bench ${m.name}: measured file "${path}" does not exist`);
  }
}

/**
 * Domain rows, each augmented by its deviation from the baseline. Key is the measurement/case
 * pair: two benchmarks touching the same source file no longer overwrite each other. Nothing is mutated —
 * what goes to disk is not what the benchmark still holds.
 */
function confronteBaseline(domaine: string, measurements: Measurement[]) {
  const baseline = chargeBaseline(domaine);
  const connus = new Map((baseline?.resultats ?? []).map((r) => [r.cle, r] as const));
  const confrontees = measurements.map((m) => ({
    ...m,
    resultats: m.resultats.map((r) => {
      const base = connus.get(rowKey(m.name, r.name));
      return { ...r, ecartBaseline: relativeGap(r.medianeMs, base?.medianeMs) };
    }),
  }));
  return { baseline: baseline !== null, mesures: confrontees };
}

/**
 * The regression gate: on a machine that recorded the domain's baseline (`npm run perf:baseline`),
 * a case whose median moved past `FAILURE_THRESHOLD` fails the benchmark. Without one it cannot fire, and
 * says so on the console rather than reading as "nothing slowed down".
 */
function garde(domaine: string, baseline: boolean, measurements: Measurement[]) {
  if (!baseline) {
    console.log(`# ${domaine}: no baseline on this machine, the regression gate is off`);
    return;
  }
  test(`${domaine}: no case slower than its baseline by more than ${FAILURE_THRESHOLD * 100} %`, () => {
    const lignes = measurements.flatMap((m) =>
      m.resultats.map((r) => ({
        name: `${m.name} | ${r.name}`,
        ecartBaseline: r.ecartBaseline ?? null,
      })),
    );
    const { regressions } = compareBaseline(lignes);
    const text = regressions.map((r) => `${r.name}: +${((r.gap ?? 0) * 100).toFixed(1)} %`);
    assert.equal(regressions.length, 0, text.join('\n'));
  });
}

/**
 * Stores domain fragment and verifies its description under `node:test`: a single false line
 * fails the benchmark.
 */
export function rapport(
  domaine: string,
  measurements: Measurement | Measurement[],
  intitule?: string,
): void {
  const brutes = Array.isArray(measurements) ? measurements : [measurements];
  verifyFiles(brutes);
  const { baseline, mesures: tous } = confronteBaseline(domaine, brutes);
  const lignes = tous.flatMap((m) => m.resultats);
  garde(domaine, baseline, tous);

  if (intitule)
    test(intitule, () => {
      for (const r of lignes) if (r.correct === false) assert.fail(`${r.name} : ${r.difference}`);
    });

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(
    fragmentPath(domaine),
    JSON.stringify({ version: 3, domaine, mesures: tous }, null, 2) + '\n',
  );
  for (const r of lignes) console.log(ligneMd(r));
}

/** Fragments deposited by a complete run of benchmarks, for their two readers. */
export function lisFragments(): Fragment[] {
  try {
    return readdirSync(FRAGMENTS)
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(FRAGMENTS, n), 'utf8')) as Fragment)
      .filter((f) => f.version === 3);
  } catch {
    return [];
  }
}
