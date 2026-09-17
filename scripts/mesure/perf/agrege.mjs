#!/usr/bin/env node
// Assemble les fragments déposés par les bancs `.perf.mjs` en un tableau unique, en console et sous
// `.mesure/out/perf/`. Les seuils d'une régression viennent de `bench/socle/baseline.mjs` et le
// rendu d'une ligne de `bench/socle/tableau.mjs` : une ligne et la conclusion du même tableau ne
// peuvent pas se contredire, et la console d'un banc affiche le même format que l'agrégat.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import {
  commitCourant,
  compareBaseline,
} from '../../../packages/sdk-core/bench/socle/baseline.mjs';
import { RACINE } from '../../../packages/sdk-core/bench/socle/chemins.mjs';
import { lisFragments } from '../../../packages/sdk-core/bench/socle/rapport.mjs';
import { entete, ligneMd } from '../../../packages/sdk-core/bench/socle/tableau.mjs';

const SORTIE = join(RACINE, '.mesure', 'out', 'perf');
const pourCent = (v) => `${(v * 100).toFixed(0)} %`;

const fragments = lisFragments();
if (fragments.length === 0) {
  console.log('Aucun fragment de mesure dans .mesure/perf/');
  process.exit(0);
}

const lignes = fragments.flatMap((f) =>
  f.mesures.flatMap((m) =>
    m.resultats.map((r) => ligneMd(r, { avant: [f.domaine, m.nom], pastilles: true })),
  ),
);
const tous = fragments.flatMap((f) => f.mesures.flatMap((m) => m.resultats));
const bilan = compareBaseline(tous);
const sansOracle = tous.filter((r) => r.correct === null);

const jour = new Date().toISOString().slice(0, 10);
const sha = commitCourant();
const charge = loadavg()[0];

const tableau = [...entete(['Domaine', 'Mesure', 'Cas']), ...lignes].join('\n');
// « 0 régression » sur un lot sans baseline se lirait comme « rien n'a ralenti » : ce n'est pas la
// même chose, et le résumé le dit.
const comparaison =
  bilan.verdict === 'absent'
    ? 'aucune baseline sur cette machine : rien de comparé (`pnpm run perf:baseline` en dépose une)'
    : `${bilan.compares} comparée(s) : ${bilan.regressions.length} régression(s) (> ${pourCent(
        bilan.seuilEchec,
      )}), ${bilan.avertissements.length} avertissement(s) (> ${pourCent(
        bilan.seuilAvertissement,
      )})`;
const resume = `${tous.length} mesures, ${sansOracle.length} sans oracle, ${comparaison}.`;
const contexte = `Machine : ${process.platform}/${process.arch}, Node ${process.version}, commit \`${sha}\`, charge ${charge.toFixed(1)}.`;

console.log(`\n${tableau}\n\n${resume}\n${contexte}`);
if (charge > 4) console.log('⚠️ Machine chargée (> 4) : temps non concluants.');

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `perf-${jour}.md`),
  `# Rapport de performance — ${jour}\n\n${contexte}\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `perf-${jour}.json`),
  JSON.stringify(
    { version: 2, date: new Date().toISOString(), commit: sha, charge, fragments },
    null,
    2,
  ) + '\n',
);
console.log(`\nÉcrit : .mesure/out/perf/perf-${jour}.md et .json`);
