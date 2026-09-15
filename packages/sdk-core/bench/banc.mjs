import test from 'node:test';
import assert from 'node:assert/strict';
// Banc de comparaison des calculs : une référence (l'ancien code recopié tel quel dans le fichier de
// banc) contre l'implémentation optimisée importée du paquet, sur les mêmes entrées. Une ligne du
// tableau n'est « retenue » que si les deux sorties sont identiques au bit près ET que la mesure
// montre un gain. Les copies de référence sont des doublons voulus : c'est l'oracle.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FRAGMENTS = join(RACINE, '.mesure', 'calculs');

/** Générateur pseudo-aléatoire à graine fixe : deux exécutions voient exactement les mêmes entrées. */
export function graine(depart) {
  let etat = depart >>> 0 || 0x9e3779b9;
  return () => {
    etat = (etat ^ (etat << 13)) >>> 0;
    etat = (etat ^ (etat >>> 17)) >>> 0;
    etat = (etat ^ (etat << 5)) >>> 0;
    return etat / 4294967296;
  };
}

const TYPES = [
  Float64Array,
  Float32Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array,
  Int8Array,
  Uint8Array,
];
const typee = (v) => TYPES.some((T) => v instanceof T);

/** Premier écart bit à bit entre deux valeurs, ou `null`. `Object.is` sépare -0 de +0 et voit NaN. */
function ecart(a, b, chemin = '', profondeur = 0) {
  if (profondeur > 8) throw new Error('BANC_PROFONDEUR');
  if (Object.is(a, b)) return null;
  if (typeof a === 'number' || typeof b === 'number')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return `${chemin}: ${String(a)} ≠ ${String(b)}`;
  if (typee(a) || typee(b)) {
    if (a.constructor !== b.constructor)
      return `${chemin}: ${a.constructor?.name} ≠ ${b.constructor?.name}`;
    if (a.length !== b.length) return `${chemin}: longueur ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++)
      if (!Object.is(a[i], b[i])) return `${chemin}[${i}]: ${a[i]} ≠ ${b[i]}`;
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${chemin}: tableau attendu des deux côtés`;
    if (a.length !== b.length) return `${chemin}: longueur ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = ecart(a[i], b[i], `${chemin}[${i}]`, profondeur + 1);
      if (e) return e;
    }
    return null;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return `${chemin}: Set attendu des deux côtés`;
    return ecart([...a], [...b], `${chemin}(Set)`, profondeur + 1);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return `${chemin}: Map attendu des deux côtés`;
    return ecart([...a], [...b], `${chemin}(Map)`, profondeur + 1);
  }
  const cles = Object.keys(a).sort(),
    autres = Object.keys(b).sort();
  if (cles.join(',') !== autres.join(','))
    return `${chemin}: champs ${cles.join(',')} ≠ ${autres.join(',')}`;
  for (const cle of cles) {
    const e = ecart(a[cle], b[cle], `${chemin}.${cle}`, profondeur + 1);
    if (e) return e;
  }
  return null;
}

/** Un tour chronométré en millisecondes. Le tour est attendu, qu'il rende une promesse ou non. */
async function chronometre(tour) {
  const t0 = process.hrtime.bigint();
  await tour();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
/** Médiane d'une série de durées, et le nombre de tours qui l'ont produite. */
function milieuDe(durees) {
  const triees = durees.slice().sort((x, y) => x - y);
  const milieu = triees.length >> 1;
  return {
    ms: triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2,
    tours: triees.length,
  };
}

/** Médiane en millisecondes d'un tour complet : échauffement, puis N tours ou le budget de temps. */
export async function mediane(tour, options = {}) {
  const { chauffe = 20, tours = 200, budgetMs = 2000 } = options;
  for (let i = 0; i < chauffe; i++) await tour();
  const durees = [];
  const debut = process.hrtime.bigint();
  while (durees.length < tours) {
    durees.push(await chronometre(tour));
    if (durees.length >= 5 && Number(process.hrtime.bigint() - debut) / 1e6 > budgetMs) break;
  }
  return milieuDe(durees);
}

/** Les deux tours alternent un à un. Mesurer l'un après l'autre donne au premier une avance qui
 *  atteint des dizaines de pour cent sur une machine chargée — tas rangé, caches chauds, fréquence
 *  qui retombe — et noie les gains modestes. En alternant, la dérive touche les deux également. */
export async function medianeAlternee(tourA, tourB, options = {}) {
  const { chauffe = 20, tours = 200, budgetMs = 2000 } = options;
  for (let i = 0; i < chauffe; i++) {
    await tourA();
    await tourB();
  }
  const a = [],
    b = [];
  const debut = process.hrtime.bigint();
  while (a.length < tours) {
    a.push(await chronometre(tourA));
    b.push(await chronometre(tourB));
    if (a.length >= 5 && Number(process.hrtime.bigint() - debut) / 1e6 > budgetMs) break;
  }
  return [milieuDe(a), milieuDe(b)];
}

/**
 * Une ligne du tableau. `cas` porte les entrées : toutes servent à l'égalité bit à bit, celles dont
 * `mesure` n'est pas `false` servent au chronomètre. Un seul écart et la ligne tombe à « non ».
 */
export async function compare({ calcul, fichier, cas, reference, optimisee, options }) {
  let difference = null;
  for (const item of cas) {
    const attendu = await reference(item.entree);
    const obtenu = await optimisee(item.entree);
    const e = ecart(attendu, obtenu, item.nom);
    if (e && !difference) difference = e;
  }
  const chronometres = cas.filter((item) => item.mesure !== false);
  const tourReference = async () => {
    for (const item of chronometres) await reference(item.entree);
  };
  const tourOptimisee = async () => {
    for (const item of chronometres) await optimisee(item.entree);
  };
  const [avant, apres] = options?.alterne
    ? await medianeAlternee(tourReference, tourOptimisee, options)
    : [await mediane(tourReference, options), await mediane(tourOptimisee, options)];
  const identique = difference === null;
  return {
    calcul,
    fichier,
    avantMs: avant.ms,
    apresMs: apres.ms,
    gain: avant.ms > 0 ? (avant.ms - apres.ms) / avant.ms : null,
    identique,
    retenu: identique && apres.ms < avant.ms,
    difference,
    tours: Math.min(avant.tours, apres.tours),
    entrees: cas.map((item) => ({ nom: item.nom, taille: item.taille ?? null })),
  };
}

const nombre = (v) => (v === null ? 'null' : v.toFixed(3));
const pourcent = (v) => (v === null ? 'null' : `${(v * 100).toFixed(1)} %`);
/** Une ligne pour la console pendant la course ; l'en-tête et le tableau final sont à `agrege.mjs`. */
function ligneMarkdown(ligne) {
  return `| ${ligne.calcul} | \`${ligne.fichier}\` | ${nombre(ligne.avantMs)} | ${nombre(
    ligne.apresMs,
  )} | ${pourcent(ligne.gain)} | ${ligne.identique ? 'oui' : 'non'} | ${
    ligne.retenu ? 'oui' : 'non'
  } |`;
}

/**
 * Vérifie l'équivalence bit à bit du domaine, puis dépose ses lignes. Chaque banc recopiait la même
 * assertion avant son dépôt ; un banc qui l'oubliait mesurait un gain sans prouver l'égalité.
 */
export function verifieEtDepose(domaine, intitule, lignes, dossier = FRAGMENTS) {
  test(intitule, () => {
    for (const ligne of lignes)
      assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
  });
  depose(domaine, lignes, dossier);
}

/** Écrit le fragment du domaine et imprime ses lignes ; `agrege.mjs` assemble le tableau complet. */
function depose(domaine, lignes, dossier) {
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, `${domaine}.json`), JSON.stringify(lignes, null, 2));
  for (const ligne of lignes) {
    console.log(ligneMarkdown(ligne));
    if (ligne.difference) console.log(`  écart : ${ligne.difference}`);
  }
}
