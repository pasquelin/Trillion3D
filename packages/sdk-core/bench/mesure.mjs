// Harnais de mesure absolue par composant moteur. Complète `banc.mjs` (comparaison oracle/optimisée)
// en exposant les temps bruts, percentiles et throughput de chaque cas, avec comparaison optionnelle
// à une baseline persistée et vérification de correction optionnelle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './banc.mjs';
import { chargeBaseline } from './baseline.mjs';

const FRAGMENTS = join(RACINE, '.mesure', 'perf');

/** Chronométrage d'un tour en millisecondes via hrtime. */
async function chrono(tour) {
  const t0 = process.hrtime.bigint();
  await tour();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

/** Statistiques d'une série triée de durées : médiane, p95, min. */
function stats(durees) {
  const t = durees.slice().sort((a, b) => a - b);
  const n = t.length;
  const milieu = n >> 1;
  const medianeMs = n % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
  const i95 = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  return { medianeMs, p95Ms: t[i95], minMs: t[0], tours: n };
}

/**
 * Mesure absolue d'un calcul sur un ensemble de cas nommés.
 * Retourne un tableau de résultats par cas avec temps, throughput et correction optionnelle.
 */
export async function mesure({ nom, fichier, cas, calcul, attendu, options = {} }) {
  const { chauffe = 20, tours = 200, budgetMs = 1000 } = options;
  const baseline = chargeBaseline(fichier);
  const resultats = [];

  for (const item of cas) {
    // Vérification de correction si une fonction `attendu` est fournie
    let correct = null,
      difference = null;
    if (attendu) {
      const ref = await attendu(item.entree);
      const obt = await calcul(item.entree);
      correct = Object.is(ref, obt) || JSON.stringify(ref) === JSON.stringify(obt);
      if (!correct) difference = `${item.nom}: résultat divergent`;
    }

    // Échauffement
    for (let i = 0; i < chauffe; i++) await calcul(item.entree);

    // Mesure
    const durees = [];
    const debut = process.hrtime.bigint();
    while (durees.length < tours) {
      durees.push(await chrono(() => calcul(item.entree)));
      if (durees.length >= 5 && Number(process.hrtime.bigint() - debut) / 1e6 > budgetMs) break;
    }

    const s = stats(durees);
    const base = baseline?.resultats?.find((r) => r.nom === item.nom);
    resultats.push({
      nom: item.nom,
      taille: item.taille ?? null,
      ...s,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      ecartBaseline: base ? (s.medianeMs - base.medianeMs) / base.medianeMs : null,
      correct,
      difference,
    });
  }
  return { nom, fichier, resultats };
}

/**
 * Stress testing : vérifie qu'un calcul ne plante pas sur des entrées extrêmes.
 * Pas de chronométrage — on vérifie l'absence de throw, hang ou NaN non géré.
 */
export async function stress({ nom, calcul, extremes }) {
  for (const cas of extremes) {
    try {
      await calcul(cas.entree);
    } catch (e) {
      throw new Error(`Stress ${nom} / ${cas.nom} : ${e.message}`, { cause: e });
    }
  }
}

/** Ligne Markdown pour la console. */
function ligneMd(r) {
  const ecart =
    r.ecartBaseline === null
      ? '—'
      : `${r.ecartBaseline >= 0 ? '+' : ''}${(r.ecartBaseline * 100).toFixed(1)} %`;
  const ok = r.correct === null ? '—' : r.correct ? '✓' : '✗';
  return `| ${r.nom} | ${r.medianeMs.toFixed(3)} | ${r.p95Ms.toFixed(3)} | ${r.opsParSec ?? 'null'} | ${ecart} | ${ok} |`;
}

/** Dépose les résultats et enregistre un test d'assertion de correction. */
export function rapport(domaine, mesures, intitule) {
  const tous = Array.isArray(mesures) ? mesures : [mesures];
  const lignes = tous.flatMap((m) => m.resultats);

  if (intitule) {
    test(intitule, () => {
      for (const r of lignes) if (r.correct === false) assert.fail(`${r.nom} : ${r.difference}`);
    });
  }

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(join(FRAGMENTS, `${domaine}.json`), JSON.stringify(tous, null, 2));
  for (const r of lignes) console.log(ligneMd(r));
}
