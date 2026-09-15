import { LIGHT_SETTINGS, type SceneLight } from './sceneLightContracts.ts';

/** Ce que l'ordonnanceur sait de la vue : une caméra, pas une matrice, pour rester sans dépendance. */
export interface ShadowViewpoint {
  position: readonly [number, number, number];
  forward: readonly [number, number, number];
  halfFovY: number;
  aspect: number;
  near: number;
  far: number;
}
/** La sphère qu'une cascade couvre, et la boîte que sa carte dessine, toutes deux en mètres. */
interface SunCascade {
  center: [number, number, number];
  radius: number;
  /** Centre et rayon de la boîte de la projection : ce que le rejet oppose aux clusters. */
  boxCenter: [number, number, number];
  boxRadius: number;
}

/**
 * Les bornes des cascades le long de l'axe de la caméra. Découpe pratique : le mélange de la suite
 * géométrique — celle qui donne la même erreur relative partout — et de la suite uniforme, dosé par
 * `sunCascadeLambda`. La dernière borne est la distance d'ombre, une fraction publiée du lointain.
 */
export function sunCascadeSplits(view: ShadowViewpoint, out: Float64Array) {
  const count = LIGHT_SETTINGS.sunCascades;
  const near = Math.max(1e-3, view.near),
    far = Math.max(near * 1.001, view.far * LIGHT_SETTINGS.sunShadowFarFraction);
  const lambda = LIGHT_SETTINGS.sunCascadeLambda;
  out[0] = near;
  for (let i = 1; i <= count; i++) {
    const ratio = i / count;
    const log = near * Math.pow(far / near, ratio),
      uniform = near + (far - near) * ratio;
    out[i] = lambda * log + (1 - lambda) * uniform;
  }
}

const splits = new Float64Array(LIGHT_SETTINGS.sunCascades + 1);
const cascade: SunCascade = {
  center: [0, 0, 0],
  radius: 1,
  boxCenter: [0, 0, 0],
  boxRadius: 1,
};

/**
 * La sphère circonscrite au tronc de caméra entre deux distances, centrée sur l'axe de la vue. Une
 * sphère, et non la boîte exacte, parce qu'elle ne dépend pas de l'orientation du soleil : la carte
 * garde alors la même emprise quand la caméra tourne, donc la même densité de texels et aucun
 * scintillement de bord. C'est l'approximation nommée de la cascade (P5).
 */
function frustumSphere(view: ShadowViewpoint, near: number, far: number) {
  const tanY = Math.tan(view.halfFovY),
    k2 = tanY * tanY * (1 + view.aspect * view.aspect);
  if (k2 * (far + near) >= far - near) return { distance: far, radius: far * Math.sqrt(k2) };
  const distance = 0.5 * (far + near) * (1 + k2);
  const span = far - near,
    sum = far + near;
  const radius =
    0.5 * Math.sqrt(span * span + 2 * (far * far + near * near) * k2 + sum * sum * k2 * k2);
  return { distance, radius };
}

/**
 * La cascade `index` d'une lampe directionnelle : sa sphère, puis la boîte que sa carte dessine —
 * la sphère reculée vers le soleil de `sunCascadeDepthScale` rayons, pour que ce qui se tient entre
 * la cascade et le soleil y projette son ombre. Le centre est aligné sur la grille de texels de la
 * carte : sans cet alignement, un pas de caméra d'un demi-texel ferait frémir tous les contours.
 *
 * L'objet rendu est réutilisé d'un appel à l'autre : l'ordonnanceur n'alloue rien par image.
 */
export function sunCascadeOf(
  view: ShadowViewpoint,
  axis: readonly number[],
  index: number,
  side: number,
) {
  sunCascadeSplits(view, splits);
  const { distance, radius } = frustumSphere(view, splits[index], splits[index + 1]);
  const texel = (2 * radius) / Math.max(1, side);
  for (let a = 0; a < 3; a++) {
    const value = view.position[a] + view.forward[a] * distance;
    // L'alignement se fait sur les axes du monde : ceux de la carte tournent avec la cascade, ceux
    // du monde ne bougent jamais, et c'est la stabilité d'une image à l'autre qu'on cherche.
    cascade.center[a] = Math.round(value / texel) * texel;
  }
  cascade.radius = radius;
  // Boîte de la projection : côté `2r`, profondeur `(depthScale + 1)·r`, donc un centre reculé de
  // `(depthScale − 1)·r/2` vers le soleil par rapport au centre de la sphère.
  const back = (radius * (LIGHT_SETTINGS.sunCascadeDepthScale - 1)) / 2;
  for (let a = 0; a < 3; a++) cascade.boxCenter[a] = cascade.center[a] - axis[a] * back;
  const halfDepth = (radius * (LIGHT_SETTINGS.sunCascadeDepthScale + 1)) / 2;
  cascade.boxRadius = Math.hypot(radius, radius, halfDepth);
  return cascade;
}

/** L'axe de propagation d'une lampe directionnelle, normalisé une fois pour toutes par le contrat. */
export const sunAxisOf = (light: SceneLight) => light.direction as [number, number, number];
