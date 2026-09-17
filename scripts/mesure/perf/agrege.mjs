#!/usr/bin/env node
// Assemble les fragments de mesure absolue déposés par les fichiers `.perf.mjs` dans
// `.mesure/perf/` en un rapport Markdown et JSON brut. Structure identique à `tableau.mjs`
// pour les bancs comparatifs, mais avec des colonnes de temps absolu et baseline.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const nombre = (v) => (v === null ? 'null' : v.toFixed(3));

function lisFragments() {
  try {
    return readdirSync(FRAGMENTS)
      .filter((n) => n.endsWith('.json'))
      .flatMap((n) => JSON.parse(readFileSync(join(FRAGMENTS, n), 'utf8')));
  } catch {
    return [];
  }
}

function ecartTexte(v) {
  if (v === null) return '—';
  const signe = v >= 0 ? '+' : '';
  const pct = (v * 100).toFixed(1);
  if (v > 0.25) return `🔴 ${signe}${pct} %`;
  if (v > 0.1) return `⚠️ ${signe}${pct} %`;
  return `${signe}${pct} %`;
}

const ENTETE = '| Domaine | Cas | Médiane (ms) | P95 (ms) | Ops/s | vs Baseline | Correct |';
const SEP = '|---|---|---|---|---|---|---|';

function ligneMd(domaine, r) {
  const ok = r.correct === null ? '—' : r.correct ? '✓' : '✗';
  return `| ${domaine} | ${r.nom} | ${nombre(r.medianeMs)} | ${nombre(r.p95Ms)} | ${r.opsParSec ?? 'null'} | ${ecartTexte(r.ecartBaseline)} | ${ok} |`;
}

const mesures = lisFragments();
if (mesures.length === 0) {
  console.log('Aucun fragment de mesure trouvé dans .mesure/perf/');
  process.exit(0);
}

const lignes = mesures.flatMap((m) => m.resultats.map((r) => ligneMd(m.nom, r)));
const tous = mesures.flatMap((m) => m.resultats);
const regressions = tous.filter((r) => r.ecartBaseline !== null && r.ecartBaseline > 0.1);

const jour = new Date().toISOString().slice(0, 10);
const sha = commitCourant();
const charge = loadavg()[0];

const tableau = [ENTETE, SEP, ...lignes].join('\n');
const resume = `${tous.length} mesures, ${regressions.length} régressions (> 10 %).`;
const contexte = `Machine : ${process.platform}/${process.arch}, Node ${process.version}, commit \`${sha}\`, charge ${charge.toFixed(1)}.`;

console.log(`\n${tableau}\n\n${resume}\n${contexte}`);
if (charge > 4) console.log('⚠️ Machine chargée (> 4) : temps non concluants.');

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `perf-${jour}.md`),
  `# Rapport Perf — ${jour}\n\n${contexte}\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `perf-${jour}.json`),
  JSON.stringify(
    { version: 1, date: new Date().toISOString(), commit: sha, charge, mesures },
    null,
    2,
  ) + '\n',
);
console.log(`\nÉcrit : .mesure/out/perf/perf-${jour}.md et .json`);
