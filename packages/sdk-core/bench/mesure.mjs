// Harnais unifié de mesure absolue par composant moteur.
// Intègre : chronométrage précis, comparaison oracle bit-à-bit, tolérance ULP,
// stress testing, gestion de baselines et isolation processus neuf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargeBaseline } from './baseline.mjs';
import { ecart } from './ecart.mjs';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRAGMENTS = join(RACINE, '.mesure', 'perf');

/** Générateur pseudo-aléatoire à graine fixe (xorshift32 déterministe). */
export function graine(depart) {
  let etat = depart >>> 0 || 0x9e3779b9;
  return () => {
    etat = (etat ^ (etat << 13)) >>> 0;
    etat = (etat ^ (etat >>> 17)) >>> 0;
    etat = (etat ^ (etat << 5)) >>> 0;
    return etat / 4294967296;
  };
}

async function chrono(tour) {
  const t0 = process.hrtime.bigint();
  await tour();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function stats(durees) {
  const t = durees.slice().sort((a, b) => a - b);
  const n = t.length;
  const milieu = n >> 1;
  const medianeMs = n % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
  const i95 = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  return { medianeMs, p95Ms: t[i95], minMs: t[0], tours: n };
}

/** Ligne descriptive pour points de banc rejetés ou informatifs sans code optimisé. */
export function ligneDecrite({ calcul, nom, fichier, motif }) {
  return {
    nom: nom ?? calcul,
    fichier,
    resultats: [
      {
        nom: nom ?? calcul,
        taille: null,
        medianeMs: null,
        p95Ms: null,
        minMs: null,
        tours: 0,
        opsParSec: null,
        ecartBaseline: null,
        correct: null,
        difference: motif ?? 'point documenté sans optimisation',
      },
    ],
  };
}

/**
 * Mesure absolue d'un calcul sur un ensemble de cas nommés.
 * Valide l'exactitude contre un oracle `attendu` (bit à bit ou via `tolere`).
 */
export async function mesure({
  nom,
  fichier,
  cas,
  calcul,
  attendu,
  differences,
  tolere,
  options = {},
}) {
  const { chauffe = 20, tours = 200, budgetMs = 1000 } = options;
  const baseline = chargeBaseline(fichier);
  const resultats = [];

  for (const item of cas) {
    let correct = null;
    let difference = null;
    if (attendu) {
      const ref = await attendu(item.entree);
      const obt = await calcul(item.entree);
      if (differences || tolere) {
        const c = differences ? differences(ref, obt, item.nom) : null;
        const acceptable = c ? !tolere || tolere(c) : true;
        correct = acceptable;
        if (!acceptable) difference = c?.premier ?? `${item.nom}: écart hors tolérance`;
      } else {
        const diff = ecart(ref, obt, item.nom);
        correct = diff === null;
        difference = diff;
      }
    }

    if (item.mesure === false) {
      resultats.push({
        nom: item.nom,
        taille: item.taille ?? null,
        medianeMs: null,
        p95Ms: null,
        minMs: null,
        tours: 0,
        opsParSec: null,
        ecartBaseline: null,
        correct,
        difference,
      });
      continue;
    }

    for (let i = 0; i < chauffe; i++) await calcul(item.entree);

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

/** Stress testing : vérifie qu'un calcul gère les extrêmes sans lever d'exception. */
export async function stress({ nom, calcul, extremes }) {
  for (const cas of extremes) {
    try {
      await calcul(cas.entree);
    } catch (e) {
      throw new Error(`Stress ${nom} / ${cas.nom} : ${e.message}`, { cause: e });
    }
  }
}

function ligneMd(r) {
  const t = r.medianeMs !== null ? r.medianeMs.toFixed(3) : 'null';
  const p = r.p95Ms !== null ? r.p95Ms.toFixed(3) : 'null';
  const ecartTxt =
    r.ecartBaseline === null
      ? '—'
      : `${r.ecartBaseline >= 0 ? '+' : ''}${(r.ecartBaseline * 100).toFixed(1)} %`;
  const ok = r.correct === null ? '—' : r.correct ? '✓' : '✗';
  return `| ${r.nom} | ${t} | ${p} | ${r.opsParSec ?? 'null'} | ${ecartTxt} | ${ok} |`;
}

/** Dépose les fragments dans .mesure/perf/ et valide l'assertion d'égalité dans node:test. */
export function rapport(domaine, mesures, intitule) {
  const tous = Array.isArray(mesures) ? mesures : [mesures];
  const lignes = tous.flatMap((m) => m.resultats);

  if (intitule) {
    test(intitule, () => {
      for (const r of lignes) {
        if (r.correct === false) assert.fail(`${r.nom} : ${r.difference}`);
      }
    });
  }

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(join(FRAGMENTS, `${domaine}.json`), JSON.stringify(tous, null, 2) + '\n');
  for (const r of lignes) console.log(ligneMd(r));
}

export async function compare({ calcul, nom, fichier, cas, reference, optimisee, options }) {
  return mesure({
    nom: nom ?? calcul,
    fichier,
    cas,
    calcul: optimisee,
    attendu: reference,
    options,
  });
}

