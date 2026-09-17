#!/usr/bin/env node
// Dépose les fragments de `.mesure/perf/` comme baselines de référence de cette machine.
// Lancé par `pnpm run perf:baseline`, après une exécution complète des bancs.
import { sauveBaseline } from '../../../packages/sdk-core/bench/socle/baseline.mjs';
import { lisFragments } from '../../../packages/sdk-core/bench/socle/rapport.mjs';

const fragments = lisFragments();
if (fragments.length === 0) {
  console.log("Aucun fragment dans .mesure/perf/ — lancez `pnpm run perf:all` d'abord.");
  process.exit(1);
}

let lignes = 0;
for (const fragment of fragments) lignes += sauveBaseline(fragment.domaine, fragment.mesures);
console.log(`${fragments.length} domaine(s), ${lignes} ligne(s) déposées dans .mesure/baselines/.`);
