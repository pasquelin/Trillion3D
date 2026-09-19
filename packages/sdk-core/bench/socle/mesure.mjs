// Absolute measurement of an engine calculation, on named cases, against an oracle.
// This file only measures and compares: table, fragments, baselines and path
// checking of cited files are managed by `rapport.mjs`.
import { ecart } from './ecart.mjs';

/** Pseudo-random generator with fixed seed (xorshift32): two executions see the same inputs. */
export function graine(depart) {
  let etat = depart >>> 0 || 0x9e3779b9;
  return () => {
    etat = (etat ^ (etat << 13)) >>> 0;
    etat = (etat ^ (etat >>> 17)) >>> 0;
    etat = (etat ^ (etat << 5)) >>> 0;
    return etat / 4294967296;
  };
}

function stats(durees) {
  const t = durees.slice().sort((a, b) => a - b);
  const n = t.length;
  const milieu = n >> 1;
  const medianeMs = n % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
  const i95 = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  return { medianeMs, p95Ms: t[i95], minMs: t[0], tours: n };
}

/** Fields of a row not fed by any timer. `null` is never zero. */
const SANS_MESURE = {
  medianeMs: null,
  p95Ms: null,
  minMs: null,
  nsParElement: null,
  tours: 0,
  opsParSec: null,
};

const ligne = ({ name, size = null, motif = null, correct = null, difference = null }) => ({
  name,
  size,
  ...SANS_MESURE,
  correct,
  difference,
  motif,
});

/** A row without figures: a documented benchmark point whose description replaces measurement. */
export function ligneDecrite({ name, fichier, motif }) {
  return { name, fichier, resultats: [ligne({ name, motif })] };
}

const compteTexte = (c) => `${c.nombre} discrepancy(ies), ${c.ulpMax} ULP at most`;

/**
 * Compares a case to its oracle. Without `differences`, equality is strict bitwise; with, the
 * count of discrepancies is published as is — the benchmark then measures a REFUSED candidate and quantifies what it
 * displaces, instead of demanding equality that does not apply. Without oracle, the line bears the
 * reason stating why and where accuracy is maintained; never silence.
 */
async function verifie(item, { calcul, attendu, differences, motif }) {
  if (!attendu) return { correct: null, difference: null, motif: motif ?? null };
  const ref = await attendu(item.input);
  const obt = await calcul(item.input);
  if (!differences) {
    const diff = ecart(ref, obt, item.name);
    return { correct: diff === null, difference: diff, motif: null };
  }
  return { correct: null, difference: null, motif: compteTexte(differences(ref, obt, item.name)) };
}

/**
 * Absolute measurement of a calculation on a set of named cases, each verified against `attendu`.
 * `fichier` is the measured path, or list of paths; `mesure: false` on a case verifies it without timing.
 */
export async function mesure({ name, fichier, cas, options = {}, ...conf }) {
  const { chauffe = 20, tours = 200, budgetMs = 1000 } = options;
  const resultats = [];

  for (const item of cas) {
    const verdict = await verifie(item, conf);

    if (item.mesure === false) {
      resultats.push(ligne({ ...verdict, name: item.name, size: item.size }));
      continue;
    }

    for (let i = 0; i < chauffe; i++) await conf.calcul(item.input);

    // Two clock readings per turn, not three: the end of a turn is also where the
    // budget is evaluated. The timer wraps exactly the call, as before.
    const durees = [];
    const debut = process.hrtime.bigint();
    let fin;
    while (durees.length < tours) {
      const t0 = process.hrtime.bigint();
      await conf.calcul(item.input);
      fin = process.hrtime.bigint();
      durees.push(Number(fin - t0) / 1e6);
      if (durees.length >= 5 && Number(fin - debut) / 1e6 > budgetMs) break;
    }

    const s = stats(durees);
    resultats.push({
      name: item.name,
      size: item.size ?? null,
      ...s,
      nsParElement: item.size > 0 ? (s.medianeMs * 1e6) / item.size : null,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      ...verdict,
    });
  }
  return { name, fichier, resultats };
}

/** Checks that a calculation absorbs its extremes without throwing: no exception is the contract. */
export async function stress({ name, calcul, extremes }) {
  for (const cas of extremes) {
    try {
      await calcul(cas.input);
    } catch (e) {
      throw new Error(`Stress ${name} / ${cas.name} : ${e.message}`, { cause: e });
    }
  }
}

/** Measures package code using the pre-optimisation implementation as the oracle. */
export const compare = ({ reference, optimisee, ...reste }) =>
  mesure({ ...reste, calcul: optimisee, attendu: reference });
