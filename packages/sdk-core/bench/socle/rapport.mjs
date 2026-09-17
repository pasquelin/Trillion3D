// Le rendu d'un banc : l'assertion d'exactitude, la comparaison à la baseline du domaine, le
// fragment déposé dans `.mesure/perf/` et la ligne de tableau affichée en console.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargeBaseline, cleDeLigne, niveauEcart } from './baseline.mjs';
import { RACINE } from './mesure.mjs';

const FRAGMENTS = join(RACINE, '.mesure', 'perf');

const ms = (v) => (v === null ? 'null' : v.toFixed(3));
const ns = (v) => (v === null ? '—' : v.toFixed(1));

function ecartTexte(v) {
  if (niveauEcart(v) === 'absent') return '—';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
}

function ligneMd(r) {
  const ok = r.correct === null ? '—' : r.correct ? '✓' : '✗';
  return `| ${r.nom} | ${ms(r.medianeMs)} | ${ms(r.p95Ms)} | ${ns(r.nsParElement)} | ${
    r.opsParSec ?? 'null'
  } | ${ecartTexte(r.ecartBaseline)} | ${ok} | ${r.motif ?? ''} |`;
}

/**
 * Renseigne `ecartBaseline` de chaque ligne à partir de la baseline du domaine. La clé est le
 * couple mesure/cas : deux bancs qui touchent le même fichier source ne s'écrasent plus.
 */
function confronteBaseline(domaine, mesures) {
  const baseline = chargeBaseline(domaine);
  if (!baseline) return 0;
  const connus = new Map(baseline.resultats.map((r) => [r.cle, r]));
  let compares = 0;
  for (const m of mesures)
    for (const r of m.resultats) {
      const base = connus.get(cleDeLigne(m.nom, r.nom));
      if (!base?.medianeMs || r.medianeMs === null) continue;
      r.ecartBaseline = (r.medianeMs - base.medianeMs) / base.medianeMs;
      compares++;
    }
  return compares;
}

/**
 * Dépose le fragment du domaine et vérifie son intitulé sous `node:test` : une seule ligne fausse
 * fait tomber le banc. Une ligne sans oracle porte son motif, jamais un silence.
 */
export function rapport(domaine, mesures, intitule) {
  const tous = Array.isArray(mesures) ? mesures : [mesures];
  const lignes = tous.flatMap((m) => m.resultats);
  const compares = confronteBaseline(domaine, tous);

  if (intitule)
    test(intitule, () => {
      for (const r of lignes) if (r.correct === false) assert.fail(`${r.nom} : ${r.difference}`);
    });

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(
    join(FRAGMENTS, `${domaine}.json`),
    JSON.stringify({ version: 2, domaine, compares, mesures: tous }, null, 2) + '\n',
  );
  for (const r of lignes) console.log(ligneMd(r));
}
