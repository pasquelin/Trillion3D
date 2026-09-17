// Mesure absolue d'un calcul du moteur, sur des cas nommés, contre un oracle.
// Ce fichier ne fait que mesurer et comparer : le tableau, les fragments et les baselines sont
// l'affaire de `rapport.mjs`, et la comparaison bit à bit celle d'`ecart.mjs` et d'`ulp.mjs`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ecart } from './ecart.mjs';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Générateur pseudo-aléatoire à graine fixe (xorshift32) : deux exécutions voient les mêmes entrées. */
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

function vide(nom, taille, motif, correct = null, difference = null) {
  return {
    nom,
    taille: taille ?? null,
    medianeMs: null,
    p95Ms: null,
    minMs: null,
    nsParElement: null,
    tours: 0,
    opsParSec: null,
    ecartBaseline: null,
    correct,
    difference,
    motif: motif ?? null,
  };
}

/** Une ligne sans chiffre : un point de banc documenté, dont le motif remplace la mesure. */
export function ligneDecrite({ nom, fichier, motif }) {
  return { nom, fichier, resultats: [vide(nom, null, motif)] };
}

/** Le fichier mesuré doit exister : une ligne qui cite un chemin mort ne mesure plus rien. */
function verifieFichier(nom, fichier) {
  for (const chemin of String(fichier).split(',')) {
    const propre = chemin.trim();
    if (propre && !existsSync(join(RACINE, propre)))
      throw new Error(`Banc ${nom} : le fichier mesuré « ${propre} » n'existe pas`);
  }
}

const compteTexte = (c) => `${c.nombre} écart(s), ${c.ulpMax} ULP au plus`;

/**
 * Compare un cas à son oracle. Sans `differences`, l'égalité est stricte au bit près ; avec, c'est
 * `tolere` qui décide. `ecartPublie` change la nature du point : le banc ne réclame plus l'égalité,
 * il chiffre l'écart d'un candidat refusé — la ligne porte alors son compte, jamais un silence.
 */
async function verifie(item, calcul, attendu, differences, tolere, ecartPublie, motifDefaut) {
  const oracle = item.attendu === null ? null : (item.attendu ?? attendu);
  if (!oracle) return { correct: null, difference: null, motif: item.motif ?? motifDefaut ?? null };
  const ref = await oracle(item.entree);
  const obt = await calcul(item.entree);
  const cmp = item.differences ?? differences;
  const seuil = item.tolere ?? tolere;
  if (!cmp) {
    const diff = ecart(ref, obt, item.nom);
    return { correct: diff === null, difference: diff, motif: null };
  }
  const compte = cmp(ref, obt, item.nom);
  if (item.ecartPublie ?? ecartPublie)
    return { correct: null, difference: null, motif: compteTexte(compte) };
  const acceptable = seuil ? seuil(compte) : compte.nombre === 0;
  return {
    correct: acceptable,
    difference: acceptable ? null : (compte.premier ?? `${item.nom} : écart hors tolérance`),
    motif: compte.nombre ? compteTexte(compte) : null,
  };
}

/**
 * Mesure absolue d'un calcul sur un ensemble de cas nommés, chacun vérifié contre `attendu`.
 * Un cas peut porter son propre `attendu` (ou `attendu: null` et un `motif` qui dit pourquoi), ses
 * `differences` et son `tolere` ; `mesure: false` le fait vérifier sans le chronométrer.
 */
export async function mesure({
  nom,
  fichier,
  cas,
  calcul,
  attendu,
  differences,
  tolere,
  ecartPublie,
  motif: motifDefaut,
  options = {},
}) {
  const { chauffe = 20, tours = 200, budgetMs = 1000 } = options;
  verifieFichier(nom, fichier);
  const resultats = [];

  for (const item of cas) {
    const { correct, difference, motif } = await verifie(
      item,
      calcul,
      attendu,
      differences,
      tolere,
      ecartPublie,
      motifDefaut,
    );

    if (item.mesure === false) {
      resultats.push(vide(item.nom, item.taille, motif, correct, difference));
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
    resultats.push({
      nom: item.nom,
      taille: item.taille ?? null,
      ...s,
      nsParElement: item.taille > 0 ? (s.medianeMs * 1e6) / item.taille : null,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      ecartBaseline: null,
      correct,
      difference,
      motif,
    });
  }
  return { nom, fichier, resultats };
}

/** Vérifie qu'un calcul encaisse ses extrêmes sans lever : l'absence d'exception est le contrat. */
export async function stress({ nom, calcul, extremes }) {
  for (const cas of extremes) {
    try {
      await calcul(cas.entree);
    } catch (e) {
      throw new Error(`Stress ${nom} / ${cas.nom} : ${e.message}`, { cause: e });
    }
  }
}

/** Mesure le code du paquet en prenant l'implémentation d'avant l'optimisation pour oracle. */
export async function compare({ nom, fichier, cas, reference, optimisee, ...reste }) {
  return mesure({ ...reste, nom, fichier, cas, calcul: optimisee, attendu: reference });
}
