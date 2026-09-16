// Oracles mathématiques et algorithmes de référence pour Web Geometry : TypeScript pur, sans DOM
// ni dépendance plateforme.
import { referenceScreenError, screenErrorVariant } from './screenErrorVariant.ts';

/** Produit scalaire de deux vecteurs de même dimension. */
export function dot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error('Dimensions incompatibles');
  }
  let sum = 0;
  for (let i = 0; i < left.length; i++) {
    sum += left[i] * right[i];
  }
  return sum;
}

/**
 * Largest factor by which a 3x3 linear map can stretch a distance: its largest singular value,
 * obtained in closed form from the symmetric matrix A^T A. A rotation reports exactly 1.
 *
 * The cluster cut projects every screen error through this exact stretch, so a rotated instance is
 * refined against the pixel budget it actually asks for.
 *
 * `elements` is a column-major 4x4 as stored by a 3D library: indices 0,1,2 / 4,5,6 / 8,9,10.
 */
export function maxStretch(elements: ArrayLike<number>): number {
  if (elements.length < 11) throw new Error('Matrice invalide');
  const a = elements[0],
    b = elements[4],
    c = elements[8];
  const d = elements[1],
    e = elements[5],
    f = elements[9];
  const g = elements[2],
    h = elements[6],
    i = elements[10];
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d) ||
    !Number.isFinite(e) ||
    !Number.isFinite(f) ||
    !Number.isFinite(g) ||
    !Number.isFinite(h) ||
    !Number.isFinite(i)
  )
    throw new Error('Matrice invalide');
  const m00 = a * a + d * d + g * g,
    m11 = b * b + e * e + h * h,
    m22 = c * c + f * f + i * i;
  const m01 = a * b + d * e + g * h,
    m02 = a * c + d * f + g * i,
    m12 = b * c + e * f + h * i;
  const offDiagonal = m01 * m01 + m02 * m02 + m12 * m12;
  if (offDiagonal <= 0) return Math.sqrt(Math.max(m00, m11, m22, 0));
  const mean = (m00 + m11 + m22) / 3;
  const spread = Math.sqrt(
    ((m00 - mean) ** 2 + (m11 - mean) ** 2 + (m22 - mean) ** 2 + 2 * offDiagonal) / 6,
  );
  if (!(spread > 0)) return Math.sqrt(Math.max(mean, 0));
  const b00 = (m00 - mean) / spread,
    b11 = (m11 - mean) / spread,
    b22 = (m22 - mean) / spread;
  const b01 = m01 / spread,
    b02 = m02 / spread,
    b12 = m12 / spread;
  const determinant =
    b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  const angle = Math.acos(Math.min(1, Math.max(-1, determinant / 2))) / 3;
  return Math.sqrt(Math.max(mean + 2 * spread * Math.cos(angle), 0));
}

/**
 * Erreur écran certifiée d'un cluster (C4) : un majorant, en pixels, du déplacement à l'écran de
 * tout point d'une sphère déplacé d'au plus ε, sous projection perspective, hors axe compris.
 *
 * Repère de vue : œil à l'origine, regard vers −z, profondeur d = −z ; pixel (f_x·x/d, f_y·y/d),
 * f = max(f_x, f_y). La primitive passe en vue par une application affine d'étirement maximal s :
 * la sphère objet (c, r) tient dans la boule de vue (C, ρ = r·s), un déplacement objet d'au plus ε
 * y devient un déplacement Δ d'au plus δ = ε·s.
 *
 * 1. Un point P = (x, y, d) de la boule va en P' = P + Δ, de profondeur d' = d + Δd. Avec
 *    q = (x, y)/d : π(P') − π(P) = f·(Δxy − q·Δd)/d'. L'application Δ ↦ Δxy − q·Δd a pour norme
 *    √(1 + |q|²) (valeurs propres de I + q·qᵀ : 1 et 1 + |q|²) ; donc, quelle que soit la direction
 *    de Δ — perpendiculaire à l'axe, en profondeur vers la caméra ou à l'opposé, oblique —,
 *    |π(P') − π(P)| ≤ f·δ·√(1 + |q|²) / d'.
 * 2. Sur la boule : d ≥ m = −C_z − ρ, la profondeur minimale ; |(x, y)| ≤ ℓ + ρ, où ℓ = |(C_x, C_y)|
 *    est la distance du centre à l'axe de vue ; donc |q| ≤ (ℓ + ρ)/m, et d' ≥ m − δ.
 * 3. Si m − δ > near (donc > 0) : E = f·δ·√(m² + (ℓ + ρ)²) / (m·(m − δ)). Sinon la boule, ou l'un
 *    de ses points déplacé, atteint le plan proche : infini, qui raffine.
 *
 * Monotonie de la coupe : m est l'infimum de la profondeur sur la boule et ℓ + ρ le supremum de la
 * distance à l'axe ; une boule contenue dans une autre annonce donc moins, une erreur plus grande
 * plus. Le long du rayon (C → k·C, k > 1, profondeur du centre C_d > 0), (kℓ + ρ)/(k·C_d − ρ) et
 * 1/(k·C_d − ρ − δ) décroissent : l'erreur annoncée décroît avec la distance. Les deux bornes de
 * l'étape 2 viennent de deux points différents de la boule : E est serrée pour une petite sphère,
 * large quand la boule frôle le plan proche loin de l'axe (`bench/justesse/erreur-ecran-borne.mjs`).
 *
 * Aucune garde ici : l'appelant a déjà traité l'erreur nulle, infinie ou invalide. Une profondeur
 * ou une distance à l'axe non finie rend l'infini. L'ordre des opérations, (δ·f)/m puis un facteur
 * √/(m − δ) ≥ 1, garde le résultat arrondi au-dessus du plancher `errorFloorAt` de sdk-browser.
 * Miroir WGSL : `projected` de `gpuDagShader.ts`, mêmes opérandes, même ordre.
 */
export function screenErrorBound(
  error: number,
  stretch: number,
  lateral: number,
  depth: number,
  radius: number,
  focal: number,
  near: number,
): number {
  // Commutateur d'EXPÉRIENCE (`screenErrorVariant.ts`), lu ici pour toute la sélection processeur.
  if (screenErrorVariant() !== 'certifiee')
    return referenceScreenError(error, stretch, depth, focal, near);
  const reach = radius * stretch,
    shift = error * stretch;
  const nearest = depth - reach,
    closest = nearest - shift,
    side = lateral + reach;
  // Le plan proche d'abord : la racine de l'hypoténuse était prise puis jetée quand il est atteint.
  if (!(closest > near)) return Infinity;
  const slant = Math.sqrt(nearest * nearest + side * side);
  if (!(slant >= nearest && slant < Infinity)) return Infinity;
  return ((shift * focal) / nearest) * (slant / closest);
}

/**
 * `screenErrorBound` d'un cluster dont le centre de vue est donné, paramètres validés. Une erreur
 * nulle rend 0 partout, plan proche compris, et une erreur infinie (aucun remplaçant) l'infini :
 * les deux restent sélectionnables. `radius` est en unités objet, étiré comme l'erreur.
 */
export function clusterErrorPixels(
  clusterError: number,
  stretch: number,
  centreX: number,
  centreY: number,
  centreZ: number,
  radius: number,
  focal: number,
  near: number,
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  // Aucune garde sur le centre : un NaN ou un ±infini en x ou en y rend un `lateral` que
  // `clusterErrorAtDepth` refuse du même message, ses deux court-circuits étant déjà posés ici.
  const lateral = Math.sqrt(centreX * centreX + centreY * centreY);
  return clusterErrorAtDepth(clusterError, stretch, lateral, -centreZ, radius, focal, near);
}

/**
 * La même erreur projetée quand la distance du centre à l'axe de vue et sa profondeur (−z de vue)
 * sont déjà connues : un nœud qui pose plancher et plafond sur la même sphère partage sa profondeur.
 */
export function clusterErrorAtDepth(
  clusterError: number,
  stretch: number,
  lateral: number,
  depth: number,
  radius: number,
  focal: number,
  near: number,
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  if (
    !Number.isFinite(clusterError) ||
    clusterError < 0 ||
    !Number.isFinite(stretch) ||
    stretch < 0 ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isFinite(focal) ||
    focal <= 0 ||
    !Number.isFinite(near) ||
    near <= 0 ||
    !(lateral >= 0 && lateral < Infinity) ||
    !Number.isFinite(depth)
  ) {
    throw new Error('Parametres de cluster invalides');
  }
  return screenErrorBound(clusterError, stretch, lateral, depth, radius, focal, near);
}

/** Rejet de cône normal pour le culling de faces arrière. */
export function coneRejects(axisDotView: number, angle: number, directionSpread = 0): boolean {
  if (
    axisDotView < -1 ||
    axisDotView > 1 ||
    angle < 0 ||
    angle > Math.PI ||
    directionSpread < 0 ||
    directionSpread > Math.PI
  ) {
    throw new Error('Cone invalide');
  }
  const totalAngle = angle + directionSpread;
  return totalAngle < Math.PI / 2 && axisDotView < -Math.sin(totalAngle);
}
