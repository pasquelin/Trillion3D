// Les tirages pseudo-aléatoires des campagnes de justesse : un générateur reproductible, et les
// deux lois que toutes les campagnes en tirent. Les générateurs restent distincts — chaque campagne
// a publié ses chiffres avec le sien, en changer déplacerait ses cas — mais `entre` et `log`
// n'ont plus qu'une écriture.

/** Mulberry32 : suite 32 bits de bonne dispersion, avancée d'un pas à chaque tirage. */
export function mulberry32(graine) {
  let etat = graine;
  return () => {
    etat = (etat + 0x6d2b79f5) | 0;
    let t = Math.imul(etat ^ (etat >>> 15), 1 | etat);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Xorshift32 : trois décalages exclusifs, l'état ne passant jamais par zéro. */
export function xorshift32(graine) {
  let etat = graine;
  return () => {
    etat ^= etat << 13;
    etat ^= etat >>> 17;
    etat ^= etat << 5;
    return (etat >>> 0) / 4294967296;
  };
}

/**
 * Les deux lois tirées d'un générateur : `entre(a, b)` uniforme sur l'intervalle, `log(a, b)`
 * uniforme en échelle logarithmique — celle qui couvre également les décades d'une distance, d'un
 * rayon ou d'une erreur.
 */
export function lois(hasard) {
  return {
    hasard,
    entre: (a, b) => a + (b - a) * hasard(),
    log: (a, b) => a * (b / a) ** hasard(),
  };
}
