// Oracle de `bounceBudget.ts`, réécrit d'après le contrat : le lot est le plafond fois la fraction,
// arrondi, jamais nul ; la fraction suit la consigne par lissage exponentiel, bornée entre son
// plancher et un, et ne bouge pas sur un relevé absent, nul ou non fini. Les constantes viennent
// du contrat, pour que l'oracle ne dérive pas en silence.
import { BOUNCE_SETTINGS } from '../../bounceContracts.ts';

export function referenceBounceBatch(ceiling, load) {
  return Math.max(1, Math.round(ceiling * load));
}

/** La même forme que `createBounceBudget` : un budget qui observe et publie ses trois champs. */
export function referenceBudgetSequence(budgetMs) {
  const { budgetSmoothing, budgetFloor } = BOUNCE_SETTINGS;
  const bornee = (f) => Math.min(1, Math.max(budgetFloor, f));
  const etat = { load: 1, lastMs: null, samples: 0 };
  return {
    get load() {
      return etat.load;
    },
    get lastMs() {
      return etat.lastMs;
    },
    get samples() {
      return etat.samples;
    },
    observe(ms) {
      if (ms === null || !Number.isFinite(ms) || ms <= 0) return;
      etat.lastMs = ms;
      etat.samples++;
      const voulue = bornee((etat.load * budgetMs) / ms);
      etat.load = bornee(etat.load + (voulue - etat.load) * budgetSmoothing);
    },
  };
}
