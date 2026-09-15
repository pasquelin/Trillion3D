import { BOUNCE_SETTINGS } from './bounceContracts.ts';

/**
 * Le budget du rebond, en millisecondes (X4, LR2).
 *
 * La spécification demande une durée, pas un compte : « la cadence ne bouge jamais, c'est la lumière
 * qui converge ». Le lot précédent tenait un nombre de rayons fixe, réglé à la main sur une scène et
 * faux sur toutes les autres. Ici le moteur reçoit une durée cible par image, lit le chronomètre de
 * l'étape « Rebond » de la carte graphique — celui du profil par étape, pas une estimation — et
 * corrige la fraction de son plafond de travail qu'il encodera à l'image suivante.
 *
 * La correction est multiplicative et lissée : la fraction visée est celle qui ramènerait la durée
 * mesurée sur la consigne, et l'on n'en reprend qu'une part à chaque relevé. Deux bornes tiennent
 * la boucle : la fraction ne dépasse jamais un — les plafonds publiés restent des bornes connues
 * avant l'image (X2) — et ne descend jamais sous son plancher, sous lequel la convergence
 * n'avancerait plus du tout.
 *
 * Approximation nommée : les relevés d'horodatage reviennent avec plusieurs images de retard et
 * n'arrivent qu'une image sur trois ou sur douze selon ce que l'hôte a demandé. La durée observée
 * décrit donc une image déjà encodée, à une fraction voisine de la fraction courante ; c'est le
 * lissage qui rend la boucle stable malgré ce retard. Sans chronomètre, la fraction reste à un et
 * le rebond se comporte exactement comme au lot précédent, ce qui est déclaré et non deviné.
 */
export interface BounceBudget {
  /** Fraction du plafond de travail que l'image encodera : entre le plancher et un. */
  readonly load: number;
  /** La dernière durée d'étape observée, ou `null` tant qu'aucune ne l'a été. */
  readonly lastMs: number | null;
  /** Relevés retenus. Zéro veut dire que l'appareil ne sait pas chronométrer ses passes. */
  readonly samples: number;
  /** La consigne, en millisecondes, telle que l'hôte l'a réglée. */
  readonly budgetMs: number;
  observe(ms: number | null): void;
}

/**
 * Le lot d'une image : la fraction du plafond publié que le budget tient, arrondie, jamais nulle.
 * La passe de sondes et celle du cache de surfaces plafonnent de la même façon — deux arrondis
 * séparés auraient fini par ne plus avancer au même rythme sous le même budget.
 */
export function bounceBatchOf(ceiling: number, load: number) {
  return Math.max(1, Math.round(ceiling * load));
}

export function createBounceBudget(budgetMs: number): BounceBudget {
  const target = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : BOUNCE_SETTINGS.budgetMs;
  const { budgetSmoothing, budgetFloor } = BOUNCE_SETTINGS;
  /** Les deux bornes de la boucle : jamais au-delà des plafonds publiés, jamais sous le plancher. */
  const bounded = (fraction: number) => Math.min(1, Math.max(budgetFloor, fraction));
  let load = 1,
    lastMs: number | null = null,
    samples = 0;
  return {
    get load() {
      return load;
    },
    get lastMs() {
      return lastMs;
    },
    get samples() {
      return samples;
    },
    budgetMs: target,
    observe(ms) {
      // Une étape qui n'a pas eu lieu, un relevé tronqué ou un appareil sans horodatage ne disent
      // rien : la fraction ne bouge pas plutôt que de suivre un zéro qui n'est pas une mesure.
      if (ms === null || !Number.isFinite(ms) || ms <= 0) return;
      lastMs = ms;
      samples++;
      const wanted = bounded((load * target) / ms);
      load = bounded(load + (wanted - load) * budgetSmoothing);
    },
  };
}
