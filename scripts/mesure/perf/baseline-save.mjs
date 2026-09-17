#!/usr/bin/env node
// Dépose les fragments de `.mesure/perf/` comme baselines de référence de cette machine.
// Lancé par `pnpm run perf:baseline`, après une exécution complète des bancs.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sauveBaseline } from '../../../packages/sdk-core/bench/socle/baseline.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRAGMENTS = join(RACINE, '.mesure', 'perf');

let fragments;
try {
  fragments = readdirSync(FRAGMENTS).filter((n) => n.endsWith('.json'));
} catch {
  console.log("Aucun fragment dans .mesure/perf/ — lancez `pnpm run perf:all` d'abord.");
  process.exit(1);
}

let lignes = 0;
for (const nom of fragments) {
  const fragment = JSON.parse(readFileSync(join(FRAGMENTS, nom), 'utf8'));
  lignes += sauveBaseline(fragment.domaine, fragment.mesures);
}
console.log(`${fragments.length} domaine(s), ${lignes} ligne(s) déposées dans .mesure/baselines/.`);
