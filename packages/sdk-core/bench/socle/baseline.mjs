// Performance baselines of a domain: `.mesure/baselines/<domain>.json`, outside repository because
// timing is only valid on the machine that recorded it. Each row is retrieved by the key pair
// measurement/case, never by its source file: multiple benchmarks measure the same file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RACINE, cheminBaseline, dossierBaselines } from './chemins.mjs';

/** The key of a baseline row: measurement name and case name. */
export const cleDeLigne = (mesure, cas) => `${mesure} | ${cas}`;

let commitMemoire;

/** Current commit, retrieved once per process: `baseline-save` stores thirty-nine. */
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

/** Loads a domain baseline, or `null` if the machine has not stored one yet. */
export function chargeBaseline(domaine) {
  const chemin = cheminBaseline(domaine);
  if (!existsSync(chemin)) return null;
  try {
    const lue = JSON.parse(readFileSync(chemin, 'utf8'));
    return lue?.version === 3 ? lue : null;
  } catch {
    return null;
  }
}

/** Saves a domain baseline from the fragment that `rapport()` wrote. */
export function sauveBaseline(domaine, mesures) {
  const resultats = mesures.flatMap((m) =>
    m.resultats.map((r) => ({
      cle: cleDeLigne(m.name, r.name),
      size: r.size,
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
        version: 3,
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
 * The two regression thresholds, written HERE and nowhere else: a row's status icon and
 * a report's conclusion read the exact same rule, avoiding self-contradictions.
 */
export const SEUIL_AVERTISSEMENT = 0.1;
export const SEUIL_ECHEC = 0.25;

/** A median relative to a reference median — baseline or witness; `null` without one, never `0`. */
export const ecartRelatif = (medianeMs, referenceMs) =>
  referenceMs && medianeMs !== null ? (medianeMs - referenceMs) / referenceMs : null;

/** The level of a discrepancy: `absent` if no baseline, then `ok`, `avertissement`, and `echec`. */
export function niveauEcart(ecart, options = {}) {
  const { seuilAvertissement = SEUIL_AVERTISSEMENT, seuilEchec = SEUIL_ECHEC } = options;
  if (ecart === null || ecart === undefined || Number.isNaN(ecart)) return 'absent';
  if (ecart > seuilEchec) return 'echec';
  if (ecart > seuilAvertissement) return 'avertissement';
  return 'ok';
}

/**
 * The verdict of a measurement batch, from the discrepancies that `rapport.mjs` already calculated against the
 * baseline. It does NOT recalculate: a discrepancy calculated twice can diverge.
 * `absent` when no case has a baseline — which is not the same thing as "nothing slowed down".
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
    const cas = { name: r.name, ecart: r.ecartBaseline };
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
