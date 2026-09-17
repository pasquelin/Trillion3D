// Gestion des baselines de performance : chargement, sauvegarde et comparaison.
// Les baselines sont stockées dans `.mesure/baselines/<domaine>.json` (gitignored via `.mesure/`).
// Chaque baseline enregistre le commit, la date, la machine et les résultats par cas.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './banc.mjs';

const BASELINES = join(RACINE, '.mesure', 'baselines');

function commitCourant() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Assainit un nom de domaine pour l'utiliser comme nom de fichier (remplace les / par des -). */
function assainir(domaine) {
  return domaine.replace(/[/\\]/g, '-').replace(/^-+|-+$/g, '');
}

/** Charge la baseline d'un domaine, ou `null` si inexistante. */
export function chargeBaseline(domaine) {
  const chemin = join(BASELINES, `${assainir(domaine)}.json`);
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Sauvegarde une nouvelle baseline. `mesures` est le tableau retourné par `rapport()` ou
 * un tableau de résultats plats `[{ nom, medianeMs, p95Ms, ... }]`.
 */
export function sauveBaseline(domaine, mesures) {
  const resultats = Array.isArray(mesures)
    ? mesures.flatMap((m) => (m.resultats ? m.resultats : [m]))
    : mesures.resultats;
  const baseline = {
    version: 1,
    domaine,
    commit: commitCourant(),
    date: new Date().toISOString(),
    machine: `${process.platform}/${process.arch}`,
    node: process.version,
    resultats: resultats.map((r) => ({
      nom: r.nom,
      taille: r.taille ?? null,
      medianeMs: r.medianeMs,
      p95Ms: r.p95Ms,
      minMs: r.minMs,
    })),
  };
  const nom = assainir(domaine);
  mkdirSync(BASELINES, { recursive: true });
  writeFileSync(join(BASELINES, `${nom}.json`), JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline déposée : .mesure/baselines/${nom}.json (${resultats.length} cas)`);
}

/**
 * Les deux seuils d'une régression, écrits ICI et nulle part ailleurs.
 *
 * Ils vivaient en trois exemplaires : ces deux-là, que personne n'appelait, et deux jeux dans
 * `scripts/mesure/perf/agrege.mjs` — l'un pour les pastilles du tableau, l'autre pour le résumé.
 * Les deux derniers se contredisaient : un écart de +14 % s'affichait en avertissement dans le
 * tableau et se comptait comme régression dans la conclusion de ce même tableau.
 */
export const SEUIL_AVERTISSEMENT = 0.1;
export const SEUIL_ECHEC = 0.25;

/**
 * Le niveau d'un écart : `absent` quand il n'y a pas de baseline pour ce cas, puis `ok`,
 * `avertissement` et `echec`. Une seule règle, que la pastille d'une ligne et le verdict d'un
 * rapport lisent tous les deux.
 */
export function niveauEcart(ecart, options = {}) {
  const { seuilAvertissement = SEUIL_AVERTISSEMENT, seuilEchec = SEUIL_ECHEC } = options;
  if (ecart === null || ecart === undefined || Number.isNaN(ecart)) return 'absent';
  if (ecart > seuilEchec) return 'echec';
  if (ecart > seuilAvertissement) return 'avertissement';
  return 'ok';
}

/**
 * Le verdict d'un lot de mesures, à partir des écarts que `mesure.mjs` a déjà calculés contre la
 * baseline. Il ne REFAIT pas ce calcul : un écart calculé deux fois est un écart qui peut diverger,
 * et `mesure.mjs` est le seul à tenir la baseline au moment où il mesure.
 *
 * `absent` quand aucun cas n'a de baseline : il n'y a alors rien à conclure, ce qui n'est pas la
 * même chose que « rien n'a ralenti ».
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
