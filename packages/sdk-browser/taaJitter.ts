/**
 * La gigue de l'antialiasing temporel : où chaque image échantillonne ses pixels, et la matrice de
 * rendu qui l'applique.
 *
 * La référence décale sa projection d'une fraction de pixel à chaque image, sur une suite de Halton
 * en bases 2 et 3 ; huit images couvrent le pixel régulièrement, et l'accumulation temporelle en
 * fait un sur-échantillonnage. Le décalage est une translation en espace de clip : il n'atteint que
 * la matrice que le raster, l'ombrage et le mélange lisent, jamais la caméra du moteur — la
 * sélection, ses plans et son seuil d'erreur écran ne voient rien de cette gigue.
 */

/** Longueur du cycle : huit positions de Halton (2,3), celles de la référence. */
export const TAA_SAMPLES = 8;

/**
 * Images calmes accumulées avant qu'une image puisse être tenue : deux cycles. À la première image
 * calme l'historique repart en phase zéro et la k-ième pèse 1/k, si bien que l'image tenue est la
 * MOYENNE UNIFORME de seize images qui ne dépendent que de l'état final — la même au bit près
 * d'une exécution à l'autre, ce que l'accumulation exponentielle ne donne pas : elle garderait
 * 12 % de ce que l'image était pendant que les pages et les textures arrivaient, dans un ordre qui
 * n'est jamais deux fois le même. Le prix, déclaré : à l'arrêt, les bords se raidissent une image
 * ou deux avant de reconverger — là où la référence rend sans fin.
 */
export const TAA_STILL_FRAMES = 2 * TAA_SAMPLES;

/** Le `index`-ième terme (à partir de 1) de la suite de van der Corput en base `base`, dans [0, 1). */
export function halton(index: number, base: number) {
  let result = 0,
    fraction = 1 / base,
    i = index;
  while (i > 0) {
    result += fraction * (i % base);
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

/**
 * Le décalage du pixel pour l'échantillon `sample` du cycle, en pixels et centré : chaque composante
 * est dans (−0,5, 0,5). Écrit `out[0]` et `out[1]`.
 */
export function taaJitter(sample: number, out: Float64Array) {
  const index = (sample % TAA_SAMPLES) + 1;
  out[0] = halton(index, 2) - 0.5;
  out[1] = halton(index, 3) - 0.5;
  return out;
}

/**
 * `out` = la vue-projection décalée de `(jx, jy)` pixels : une translation ajoutée en espace de clip
 * — `x += 2·jx/largeur · w`, `y += 2·jy/hauteur · w` —, donc la première et la deuxième ligne de la
 * matrice colonne-major reçoivent la quatrième multipliée par le décalage. Une gigue nulle rend la
 * matrice à l'identique, bit pour bit.
 */
export function jitterViewProjection(
  out: Float64Array,
  viewProjection: ArrayLike<number>,
  jx: number,
  jy: number,
  width: number,
  height: number,
) {
  const dx = (2 * jx) / width,
    dy = (2 * jy) / height;
  for (let column = 0; column < 4; column++) {
    const at = column * 4,
      w = viewProjection[at + 3];
    out[at] = viewProjection[at] + dx * w;
    out[at + 1] = viewProjection[at + 1] + dy * w;
    out[at + 2] = viewProjection[at + 2];
    out[at + 3] = w;
  }
  return out;
}
