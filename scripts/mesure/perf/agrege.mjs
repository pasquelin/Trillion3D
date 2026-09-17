#!/usr/bin/env node
// Assemble les fragments de mesure absolue déposés par les fichiers `.perf.mjs` dans
// `.mesure/perf/` en un rapport Markdown et JSON brut. Structure identique à `tableau.mjs`
// pour les bancs comparatifs, mais avec des colonnes de temps absolu et baseline.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareBaseline, niveauEcart } from '../../../packages/sdk-core/bench/baseline.mjs';

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

const pourCent = (v) => `${(v * 100).toFixed(0)} %`;

/** La pastille d'une ligne : le niveau vient de `baseline.mjs`, seul détenteur des seuils, si bien
 *  qu'une ligne et la conclusion du tableau ne peuvent plus se contredire. */
function ecartTexte(v) {
  const niveau = niveauEcart(v);
  if (niveau === 'absent') return '—';
  const signe = v >= 0 ? '+' : '';
  const pct = `${signe}${(v * 100).toFixed(1)} %`;
  if (niveau === 'echec') return `🔴 ${pct}`;
  if (niveau === 'avertissement') return `⚠️ ${pct}`;
  return pct;
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
const bilan = compareBaseline(tous);

const jour = new Date().toISOString().slice(0, 10);
const sha = commitCourant();
const charge = loadavg()[0];

const tableau = [ENTETE, SEP, ...lignes].join('\n');
// Le résumé nomme les deux niveaux séparément, et dit quand il n'a comparé à rien : « 0 régression »
// sur un lot sans baseline se lirait comme « rien n'a ralenti », ce qui n'est pas la même chose.
const resume =
  bilan.verdict === 'absent'
    ? `${tous.length} mesures, aucune baseline à comparer.`
    : `${tous.length} mesures, ${bilan.compares} comparées : ${bilan.regressions.length} régressions ` +
      `(> ${pourCent(bilan.seuilEchec)}), ${bilan.avertissements.length} avertissements ` +
      `(> ${pourCent(bilan.seuilAvertissement)}).`;
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
