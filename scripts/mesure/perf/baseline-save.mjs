#!/usr/bin/env node
// Sauvegarde les fragments de mesure perf comme baselines de référence.
// Appelé par `pnpm run perf:baseline` après l'exécution de tous les `.perf.mjs`.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sauveBaseline } from '../../../packages/sdk-core/bench/baseline.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRAGMENTS = join(RACINE, '.mesure', 'perf');

let fragments;
try {
  fragments = readdirSync(FRAGMENTS).filter((n) => n.endsWith('.json'));
} catch {
  console.log("Aucun fragment dans .mesure/perf/ — lancez perf:all d'abord.");
  process.exit(1);
}

for (const nom of fragments) {
  const mesures = JSON.parse(readFileSync(join(FRAGMENTS, nom), 'utf8'));
  for (const m of mesures) sauveBaseline(m.fichier, [m]);
}
console.log(`${fragments.length} domaine(s) sauvegardé(s) comme baselines.`);
