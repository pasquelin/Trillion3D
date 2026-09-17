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
 * Compare des résultats à une baseline. Retourne un objet résumé avec le verdict global
 * et les cas en régression.
 */
export function compareBaseline(resultats, baseline, options = {}) {
  const { seuilWarning = 0.1, seuilEchec = 0.25 } = options;
  if (!baseline?.resultats) return { verdict: 'absent', regressions: [], warnings: [] };
  const warnings = [],
    regressions = [];
  for (const r of resultats) {
    const base = baseline.resultats.find((b) => b.nom === r.nom);
    if (!base) continue;
    const ecart = (r.medianeMs - base.medianeMs) / base.medianeMs;
    if (ecart > seuilEchec)
      regressions.push({ nom: r.nom, ecart, base: base.medianeMs, actuel: r.medianeMs });
    else if (ecart > seuilWarning)
      warnings.push({ nom: r.nom, ecart, base: base.medianeMs, actuel: r.medianeMs });
  }
  const verdict = regressions.length > 0 ? 'echec' : warnings.length > 0 ? 'warning' : 'ok';
  return { verdict, regressions, warnings };
}
