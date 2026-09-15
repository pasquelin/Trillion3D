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
    samples = 0;
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
    /** Durée estimée de `pages` pages, ou `null` tant qu'aucun relevé n'est venu. */
    estimate(pages: number) {
      return samples ? msPerPage * pages : null;
    },
    reset() {
      msPerPage = 0;
      samples = 0;
    },
  };
}

export type ShadowBudget = ReturnType<typeof createShadowBudget>;
