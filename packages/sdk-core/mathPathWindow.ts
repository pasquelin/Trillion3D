/**
 * Les deux outils de mesure du gouverneur de chemin (`mathPathGovernor.ts`) : la finesse de
 * l'horloge du fil, et la médiane glissante sur laquelle il arbitre. Rien ici ne connaît les
 * chemins ni les opérations.
 */

/** Exécutions retenues par chemin : la médiane suit alors une minute de jeu, pas une image. */
const PATH_WINDOW = 30;
/**
 * Résolution d'horloge au-delà de laquelle aucun arbitrage n'est tenté. Un lot du moteur dure des
 * dixièmes de milliseconde : une horloge plus grossière que cela ne rend que des zéros et des sauts,
 * dont aucune médiane ne sort. Ce n'est pas une constante de machine, c'est l'ordre de grandeur de
 * ce qui est mesuré.
 */
export const CLOCK_RESOLUTION_MS = 0.1;
/** Lectures d'horloge utilisées pour estimer sa résolution : assez pour voir le plus petit pas. */
const CLOCK_PROBES = 32;

/**
 * Le plus petit écart non nul entre deux lectures successives de `now`, en millisecondes. Une
 * horloge volontairement tronquée le rend tel quel ; `null` si aucune lecture n'a bougé.
 */
export function estimateClockResolutionMs(now: () => number) {
  let plusPetit: number | null = null;
  let precedent = now();
  for (let i = 0; i < CLOCK_PROBES; i++) {
    const courant = now();
    const pas = courant - precedent;
    if (pas > 0 && (plusPetit === null || pas < plusPetit)) plusPetit = pas;
    precedent = courant;
  }
  return plusPetit;
}

/** Une médiane glissante sur les `PATH_WINDOW` dernières valeurs, sans allocation par exécution. */
export class Fenetre {
  private readonly valeurs = new Float64Array(PATH_WINDOW);
  private readonly triee = new Float64Array(PATH_WINDOW);
  private prochain = 0;
  count = 0;
  ajoute(valeur: number) {
    this.valeurs[this.prochain] = valeur;
    this.prochain = (this.prochain + 1) % PATH_WINDOW;
    if (this.count < PATH_WINDOW) this.count++;
  }
  mediane() {
    if (!this.count) return null;
    const { triee, valeurs, count } = this;
    for (let i = 0; i < count; i++) triee[i] = valeurs[i];
    triee.subarray(0, count).sort();
    const milieu = count >> 1;
    return count % 2 ? triee[milieu] : (triee[milieu - 1] + triee[milieu]) / 2;
  }
}
