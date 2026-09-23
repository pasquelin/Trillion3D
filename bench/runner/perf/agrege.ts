#!/usr/bin/env node
// Assembles fragments dropped by `.perf.ts` benches into a single table, on the console and
// under `.mesure/out/perf/`. Regression thresholds come from `bench/core/baseline.ts` and
// the rendering of a line from `bench/core/tableau.ts`: a line and the conclusion of the
// same table cannot contradict each other, and a bench console shows the same format as the aggregate.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { commitCourant, compareBaseline } from '../../core/baseline.ts';
import type { LigneAvecEcartBaseline } from '../../core/baseline.ts';
import { RACINE } from '../../core/chemins.ts';
import { lisFragments } from '../../core/rapport.ts';
import { entete, ligneMd } from '../../core/tableau.ts';

const SORTIE = join(RACINE, '.mesure', 'out', 'perf');
const pourCent = (v: number) => `${(v * 100).toFixed(0)} %`;

const fragments = lisFragments();
if (fragments.length === 0) {
  console.log('No measurement fragment in .mesure/perf/');
  process.exit(0);
}

const lignes = fragments.flatMap((f) =>
  f.mesures.flatMap((m) =>
    m.resultats.map((r) => ligneMd(r, { before: [f.domaine, m.name], pastilles: true })),
  ),
);
const tous = fragments.flatMap((f) => f.mesures.flatMap((m) => m.resultats));
// Every fragment on disk was written by `rapport()`, which always fills `ecartBaseline`;
// the type only marks it optional because a fresh, unwritten row would not have it yet.
const bilan = compareBaseline(tous as LigneAvecEcartBaseline[]);
const sansOracle = tous.filter((r) => r.correct === null);

const jour = new Date().toISOString().slice(0, 10);
const sha = commitCourant();
const charge = loadavg()[0];

const tableau = [...entete(['Domain', 'Measure', 'Case']), ...lignes].join('\n');
// "0 regression" on a batch with no baseline would read as "nothing slowed down": that is
// not the same thing, and the summary says so.
const comparaison =
  bilan.verdict === 'absent'
    ? 'no baseline on this machine: nothing compared (`pnpm run perf:baseline` deposits one)'
    : `${bilan.compares} compared: ${bilan.regressions.length} regression(s) (> ${pourCent(
        bilan.seuilEchec,
      )}), ${bilan.avertissements.length} warning(s) (> ${pourCent(bilan.seuilAvertissement)})`;
const resume = `${tous.length} measurements, ${sansOracle.length} without oracle, ${comparaison}.`;
const contexte = `Machine: ${process.platform}/${process.arch}, Node ${process.version}, commit \`${sha}\`, load ${charge.toFixed(1)}.`;

console.log(`\n${tableau}\n\n${resume}\n${contexte}`);
if (charge > 4) console.log('⚠️ Loaded machine (> 4): times not conclusive.');

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `perf-${jour}.md`),
  `# Performance report — ${jour}\n\n${contexte}\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `perf-${jour}.json`),
  JSON.stringify(
    { version: 3, date: new Date().toISOString(), commit: sha, charge, fragments },
    null,
    2,
  ) + '\n',
);
console.log(`\nWritten: .mesure/out/perf/perf-${jour}.md and .json`);
