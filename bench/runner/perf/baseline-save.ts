#!/usr/bin/env node
// Drops `.mesure/perf/` fragments as this machine's reference baselines.
// Launched by `pnpm run perf:baseline`, after a complete bench run.
import { sauveBaseline } from '../../core/baseline.ts';
import { lisFragments } from '../../core/report.ts';

const fragments = lisFragments();
if (fragments.length === 0) {
  console.log('No fragment in .mesure/perf/ — run `pnpm run perf:all` first.');
  process.exit(1);
}

let lignes = 0;
for (const fragment of fragments) lignes += sauveBaseline(fragment.domaine, fragment.mesures);
console.log(`${fragments.length} domain(s), ${lignes} row(s) dropped in .mesure/baselines/.`);
