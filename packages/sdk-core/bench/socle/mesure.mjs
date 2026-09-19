// Mesure absolue d'un calcul du moteur, sur des cas nommés, contre un oracle.
// Ce fichier ne fait que mesurer et comparer : le tableau, les fragments, les baselines et la garde
// des chemins cités sont l'affaire de `rapport.mjs`.
import { ecart } from './ecart.mjs';

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

function stats(durees) {
  const t = durees.slice().sort((a, b) => a - b);
  const n = t.length;
  const milieu = n >> 1;
  const medianeMs = n % 2 ? t[milieu] : (t[milieu - 1] + t[milieu]) / 2;
  const i95 = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  return { medianeMs, p95Ms: t[i95], minMs: t[0], tours: n };
}

/** Les champs d'une ligne qu'aucun chronomètre n'a nourrie. `null` n'est jamais zéro. */
const SANS_MESURE = {
  medianeMs: null,
  p95Ms: null,
  minMs: null,
  nsParElement: null,
  tours: 0,
  opsParSec: null,
};

const ligne = ({ nom, taille = null, motif = null, correct = null, difference = null }) => ({
  nom,
  taille,
  ...SANS_MESURE,
  correct,
  difference,
  motif,
});

/** Une ligne sans chiffre : un point de banc documenté, dont le motif remplace la mesure. */
export function ligneDecrite({ nom, fichier, motif }) {
  return { nom, fichier, resultats: [ligne({ nom, motif })] };
}

const compteTexte = (c) => `${c.nombre} écart(s), ${c.ulpMax} ULP au plus`;

/**
 * Compare un cas à son oracle. Sans `differences`, l'égalité est stricte au bit près ; avec, le
 * compte d'écarts est publié tel quel — le banc mesure alors un candidat REFUSÉ et chiffre ce qu'il
 * déplace, au lieu de réclamer une égalité qui n'a pas lieu d'être. Le `motif` de l'appelant est
 * toujours gardé : sans oracle il dit où la justesse est tenue, avec un oracle il dit ce que la
 * comparaison laisse de côté ; jamais un silence.
 */
async function verifie(item, { calcul, attendu, differences, motif }) {
  if (!attendu) return { correct: null, difference: null, motif: motif ?? null };
  const ref = await attendu(item.entree);
  const obt = await calcul(item.entree);
  if (!differences) {
    const diff = ecart(ref, obt, item.nom);
    return { correct: diff === null, difference: diff, motif: motif ?? null };
  }
  const compte = compteTexte(differences(ref, obt, item.nom));
  return { correct: null, difference: null, motif: motif ? `${compte} ; ${motif}` : compte };
}

/**
 * Mesure absolue d'un calcul sur un ensemble de cas nommés, chacun vérifié contre `attendu`.
 * `fichier` est le chemin mesuré, ou la liste des chemins ; `mesure: false` sur un cas le fait
 * vérifier sans le chronométrer.
 */
export async function mesure({ nom, fichier, cas, options = {}, ...conf }) {
  const { chauffe = 20, tours = 200, budgetMs = 1000 } = options;
  const resultats = [];

  for (const item of cas) {
    const verdict = await verifie(item, conf);

    if (item.mesure === false) {
      resultats.push(ligne({ ...verdict, nom: item.nom, taille: item.taille }));
      continue;
    }

    for (let i = 0; i < chauffe; i++) await conf.calcul(item.entree);

    // Deux lectures d'horloge par tour, pas trois : la fin d'un tour est aussi le point où le
    // budget se juge. Le chronomètre encadre exactement l'appel, comme avant.
    const durees = [];
    const debut = process.hrtime.bigint();
    let fin;
    while (durees.length < tours) {
      const t0 = process.hrtime.bigint();
      await conf.calcul(item.entree);
      fin = process.hrtime.bigint();
      durees.push(Number(fin - t0) / 1e6);
      if (durees.length >= 5 && Number(fin - debut) / 1e6 > budgetMs) break;
    }

    const s = stats(durees);
    resultats.push({
      nom: item.nom,
      taille: item.taille ?? null,
      ...s,
      nsParElement: item.taille > 0 ? (s.medianeMs * 1e6) / item.taille : null,
      opsParSec: s.medianeMs > 0 ? Math.round(1000 / s.medianeMs) : null,
      ...verdict,
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
export const compare = ({ reference, optimisee, ...reste }) =>
  mesure({ ...reste, calcul: optimisee, attendu: reference });
