// Les baselines de performance d'un domaine : `.mesure/baselines/<domaine>.json`, hors dépôt parce
// qu'un temps ne vaut que sur la machine qui l'a relevé. Chaque ligne est retrouvée par le couple
// mesure/cas, jamais par son fichier source : plusieurs bancs mesurent le même fichier.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RACINE, cheminBaseline, dossierBaselines } from './chemins.mjs';

/** La clé d'une ligne de baseline : le nom de la mesure et celui du cas. */
export const cleDeLigne = (mesure, cas) => `${mesure} | ${cas}`;

let commitMemoire;

/** Le commit courant, relevé une fois par processus : `baseline-save` en dépose trente-neuf. */
export function commitCourant() {
  if (commitMemoire === undefined) {
    try {
      commitMemoire = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: RACINE,
        encoding: 'utf8',
      }).trim();
    } catch {
      commitMemoire = null;
    }
  }
  return commitMemoire;
}

/** Charge la baseline d'un domaine, ou `null` si la machine n'en a pas encore déposé. */
export function chargeBaseline(domaine) {
  const chemin = cheminBaseline(domaine);
  if (!existsSync(chemin)) return null;
  try {
    const lue = JSON.parse(readFileSync(chemin, 'utf8'));
    return lue?.version === 2 ? lue : null;
  } catch {
    return null;
  }
}

/** Dépose la baseline d'un domaine à partir du fragment que `rapport()` a écrit. */
export function sauveBaseline(domaine, mesures) {
  const resultats = mesures.flatMap((m) =>
    m.resultats.map((r) => ({
      cle: cleDeLigne(m.nom, r.nom),
      taille: r.taille,
      medianeMs: r.medianeMs,
      p95Ms: r.p95Ms,
      minMs: r.minMs,
      nsParElement: r.nsParElement ?? null,
    })),
  );
  mkdirSync(dossierBaselines, { recursive: true });
  writeFileSync(
    cheminBaseline(domaine),
    JSON.stringify(
      {
        version: 2,
        domaine,
        commit: commitCourant(),
        date: new Date().toISOString(),
        machine: `${process.platform}/${process.arch}`,
        node: process.version,
        resultats,
      },
      null,
      2,
    ) + '\n',
  );
  return resultats.length;
}

/**
 * Les deux seuils d'une régression, écrits ICI et nulle part ailleurs : la pastille d'une ligne et
 * la conclusion d'un rapport lisent la même règle, et ne peuvent donc plus se contredire.
 */
export const SEUIL_AVERTISSEMENT = 0.1;
export const SEUIL_ECHEC = 0.25;

/** Le niveau d'un écart : `absent` faute de baseline, puis `ok`, `avertissement` et `echec`. */
export function niveauEcart(ecart, options = {}) {
  const { seuilAvertissement = SEUIL_AVERTISSEMENT, seuilEchec = SEUIL_ECHEC } = options;
  if (ecart === null || ecart === undefined || Number.isNaN(ecart)) return 'absent';
  if (ecart > seuilEchec) return 'echec';
  if (ecart > seuilAvertissement) return 'avertissement';
  return 'ok';
}

/**
 * Le verdict d'un lot de mesures, à partir des écarts que `rapport.mjs` a déjà calculés contre la
 * baseline. Il ne REFAIT pas ce calcul : un écart calculé deux fois est un écart qui peut diverger.
 * `absent` quand aucun cas n'a de baseline — ce qui n'est pas la même chose que « rien n'a ralenti ».
 */
export function compareBaseline(resultats, options = {}) {
  const { seuilAvertissement = SEUIL_AVERTISSEMENT, seuilEchec = SEUIL_ECHEC } = options;
  const seuils = { seuilAvertissement, seuilEchec };
  const avertissements = [],
    regressions = [];
  let compares = 0;
  for (const r of resultats) {
    const niveau = niveauEcart(r.ecartBaseline, seuils);
    if (niveau === 'absent') continue;
    compares++;
    const cas = { nom: r.nom, ecart: r.ecartBaseline };
    if (niveau === 'echec') regressions.push(cas);
    else if (niveau === 'avertissement') avertissements.push(cas);
  }
  const verdict = !compares
    ? 'absent'
    : regressions.length
      ? 'echec'
      : avertissements.length
        ? 'avertissement'
        : 'ok';
  return { verdict, compares, regressions, avertissements, ...seuils };
}
