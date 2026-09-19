import { LIGHT_SETTINGS } from './sceneLightContracts.ts';

/**
 * Le budget de l'étape Ombres, en millisecondes de carte graphique par image (RX3, X4).
 *
 * Le plafond « quatre lampes par image » était un compte, pas une durée : quatre cartes de 1024²
 * coûtent trente fois quatre pages de 128². Ici le travail se compte en pages et son prix vient du
 * chronomètre de la passe elle-même — le relevé d'horodatage que le profil publie déjà —, lissé d'une
 * image à l'autre. Le coût fixe d'une région (rejet, remise au fond, appel indirect) n'est pas
 * distingué du coût d'une page : il est fondu dans la moyenne, approximation nommée (P5).
 *
 * Tant qu'aucun relevé n'est venu — appareil sans horodatage, premières images — il n'y a pas de
 * budget du tout : seul le plafond de régions que les tampons publient s'applique, ce qui est
 * exactement le comportement d'avant ce lot.
 */
export function createShadowBudget() {
  let budgetMs: number = LIGHT_SETTINGS.shadowBudgetMs,
    msPerPage = 0,
    samples = 0,
    // The pose barrier drains the queue with no duration cap: the 1 ms budget is for the
    // measured loop. A GPU timestamp arriving during the drain tightened admission mid-flush,
    // and two runs left different pages (#25).
    suspended = false;
  return {
    get budgetMs() {
      return budgetMs;
    },
    /** Le budget publié par l'hôte ; une valeur non finie ou négative est refusée, pas arrondie. */
    setBudgetMs(value: number) {
      if (Number.isFinite(value) && value > 0) budgetMs = value;
    },
    /** Coût moyen d'une page, en millisecondes, ou `null` tant que rien n'a été mesuré. */
    get msPerPage() {
      return samples ? msPerPage : null;
    },
    /** The next admission ignores the budget; the buffers' region cap still applies. */
    suspend() {
      suspended = true;
    },
    resume() {
      suspended = false;
    },
    /**
     * Un relevé du chronomètre de la passe, rapporté aux pages que cette image-là avait redessinées.
     * Une image sans page redessinée n'apprend rien et n'entre pas dans la moyenne.
     */
    observe(gpuMs: number | null, pages: number) {
      if (gpuMs === null || !Number.isFinite(gpuMs) || gpuMs <= 0 || pages <= 0) return;
      const value = gpuMs / pages;
      msPerPage = samples
        ? msPerPage + (value - msPerPage) * LIGHT_SETTINGS.shadowCostBlend
        : value;
      samples++;
    },
    /** Estimated duration of `pages` pages, or `null` until a sample exists — and during a
     *  barrier, where the drain must not depend on the GPU clock. */
    estimate(pages: number) {
      return suspended || !samples ? null : msPerPage * pages;
    },
    reset() {
      msPerPage = 0;
      samples = 0;
      suspended = false;
    },
  };
}

export type ShadowBudget = ReturnType<typeof createShadowBudget>;
