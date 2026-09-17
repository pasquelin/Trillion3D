#!/usr/bin/env node
// Assemble les fragments déposés par les bancs `.perf.mjs` dans `.mesure/perf/` en un tableau
// unique, en console et sous `.mesure/out/perf/`. Les seuils d'une régression viennent de
// `bench/socle/baseline.mjs`, seul détenteur de la règle : une ligne et la conclusion du même
// tableau ne peuvent plus se contredire.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareBaseline,
  niveauEcart,
} from '../../../packages/sdk-core/bench/socle/baseline.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRAGMENTS = join(RACINE, '.mesure', 'perf');
const SORTIE = join(RACINE, '.mesure', 'out', 'perf');

function commitCourant() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const ms = (v) => (v === null ? 'null' : v.toFixed(3));
const ns = (v) => (v === null ? '—' : v.toFixed(1));
const pourCent = (v) => `${(v * 100).toFixed(0)} %`;

function lisFragments() {
  try {
    return readdirSync(FRAGMENTS)
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(FRAGMENTS, n), 'utf8')))
      .filter((f) => f.version === 2);
  } catch {
    return [];
  }
}

/** La pastille d'une ligne, au niveau que `baseline.mjs` décide. */
function ecartTexte(v) {
  const niveau = niveauEcart(v);
  if (niveau === 'absent') return '—';
  const pct = `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
  if (niveau === 'echec') return `🔴 ${pct}`;
  if (niveau === 'avertissement') return `⚠️ ${pct}`;
  return pct;
}

const ENTETE =
  '| Domaine | Mesure | Cas | Médiane (ms) | P95 (ms) | ns/élément | Ops/s | vs baseline | Oracle | Note |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

const ligneMd = (domaine, m, r) =>
  `| ${domaine} | ${m.nom} | ${r.nom} | ${ms(r.medianeMs)} | ${ms(r.p95Ms)} | ${ns(
    r.nsParElement,
  )} | ${r.opsParSec ?? 'null'} | ${ecartTexte(r.ecartBaseline)} | ${
    r.correct === null ? '—' : r.correct ? '✓' : '✗'
  } | ${r.motif ?? ''} |`;

const fragments = lisFragments();
if (fragments.length === 0) {
  console.log('Aucun fragment de mesure dans .mesure/perf/');
  process.exit(0);
}

const lignes = fragments.flatMap((f) =>
  f.mesures.flatMap((m) => m.resultats.map((r) => ligneMd(f.domaine, m, r))),
);
const tous = fragments.flatMap((f) => f.mesures.flatMap((m) => m.resultats));
const bilan = compareBaseline(tous);
const sansOracle = tous.filter((r) => r.correct === null);

const jour = new Date().toISOString().slice(0, 10);
const sha = commitCourant();
const charge = loadavg()[0];

const tableau = [ENTETE, SEP, ...lignes].join('\n');
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
