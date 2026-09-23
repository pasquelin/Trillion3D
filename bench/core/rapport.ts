// Benchmark rendering: path checking of cited files, accuracy assertion, comparison with
// domain baseline, fragment stored in `.mesure/perf/` and row printed to console.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargeBaseline, cleDeLigne, ecartRelatif } from './baseline.ts';
import { FRAGMENTS, RACINE, cheminFragment } from './chemins.ts';
import { ligneMd } from './tableau.ts';
import type { Mesure } from './mesure.ts';

/** A domain fragment deposited under `.mesure/perf/`, for the report's two readers. */
export interface Fragment {
  version: 3;
  domaine: string;
  mesures: Mesure[];
}

/** Measured paths must exist: a row citing a dead file measures nothing. */
function verifieFichiers(mesures: Mesure[]) {
  for (const m of mesures) {
    const chemins = Array.isArray(m.fichier) ? m.fichier : [m.fichier];
    for (const chemin of chemins)
      if (!existsSync(join(RACINE, chemin)))
        throw new Error(`Bench ${m.name}: measured file "${chemin}" does not exist`);
  }
}

/**
 * Domain rows, each augmented by its deviation from the baseline. Key is the measurement/case
 * pair: two benchmarks touching the same source file no longer overwrite each other. Nothing is mutated —
 * what goes to disk is not what the benchmark still holds.
 */
function confronteBaseline(domaine: string, mesures: Mesure[]): Mesure[] {
  const baseline = chargeBaseline(domaine);
  const connus = new Map((baseline?.resultats ?? []).map((r) => [r.cle, r] as const));
  return mesures.map((m) => ({
    ...m,
    resultats: m.resultats.map((r) => {
      const base = connus.get(cleDeLigne(m.name, r.name));
      return { ...r, ecartBaseline: ecartRelatif(r.medianeMs, base?.medianeMs) };
    }),
  }));
}

/**
 * Stores domain fragment and verifies its description under `node:test`: a single false line
 * fails the benchmark.
 */
export function rapport(domaine: string, mesures: Mesure | Mesure[], intitule?: string): void {
  const brutes = Array.isArray(mesures) ? mesures : [mesures];
  verifieFichiers(brutes);
  const tous = confronteBaseline(domaine, brutes);
  const lignes = tous.flatMap((m) => m.resultats);

  if (intitule)
    test(intitule, () => {
      for (const r of lignes) if (r.correct === false) assert.fail(`${r.name} : ${r.difference}`);
    });

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(
    cheminFragment(domaine),
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
