import { LIGHT_SETTINGS, type ShadowViewpoint } from './sceneLightContracts.ts';

/** La sphère qu'une cascade couvre, et la boîte que sa carte dessine, toutes deux en mètres. */
interface SunCascade {
  center: [number, number, number];
  radius: number;
  /** Centre de la boîte de la projection : ce à quoi le rejet rapporte la région qu'il découpe. */
  boxCenter: [number, number, number];
}

/**
 * Le plan proche de la caméra, au plancher d'un millimètre : une vue qui déclare zéro, ou moins,
 * n'ouvre pas la découpe sur une distance nulle. Le plancher n'est écrit qu'ici, et la distance
 * d'ombre ci-dessous le relit plutôt que d'en garder le sien.
 */
function cameraNearMetres(view: ShadowViewpoint) {
  return Math.max(1e-3, view.near);
}

/**
 * La distance d'ombre du soleil : la borne au-delà de laquelle aucune cascade ne teste plus rien.
 * C'est une fraction publiée du lointain de la caméra, tenue au-dessus de son plan proche pour que
 * la découpe garde un intervalle à partager même quand la vue n'en laisse aucun.
 */
function sunShadowFarMetres(view: ShadowViewpoint) {
  return Math.max(cameraNearMetres(view) * 1.001, view.far * LIGHT_SETTINGS.sunShadowFarFraction);
}

/**
 * Les bornes des cascades le long de l'axe de la caméra : une suite géométrique, la seule qui donne
 * la même erreur relative partout, donc la même densité de texels d'une cascade à l'autre. La
 * dernière borne est la distance d'ombre, une fraction publiée du lointain.
 *
 * La découpe ne part plus du plan proche de la caméra, qui vaut un dix-millième du lointain : la
 * suite géométrique y prenait un rapport de quatorze par cascade, et les deux premières se
 * perdaient sous le mètre ; un mélange avec une suite uniforme les rattrapait, au prix de coutures
 * déséquilibrées — deux fois entre les premières, près de cinq fois avant la dernière. Le plancher
 * est maintenant chiffré par le rapport publié : `distance d'ombre / rapport^cascades`, et la suite
 * est géométrique de bout en bout. Une caméra dont le plan proche dépasse ce plancher garde le sien,
 * et le rapport n'en est que plus serré.
 *
 * La première borne, elle, reste le plan proche de la caméra : le plancher redistribue les bornes
 * intérieures, il ne creuse aucun trou sous le nez de l'observateur. La sphère de la première
 * cascade est dominée par sa borne lointaine, si bien que la couvrir depuis le plan proche ne lui
 * coûte presque aucun texel.
 */
function sunCascadeSplits(view: ShadowViewpoint, out: Float64Array) {
  const count = LIGHT_SETTINGS.sunCascades;
  const camera = cameraNearMetres(view),
    far = sunShadowFarMetres(view);
  const near = Math.max(camera, far / Math.pow(LIGHT_SETTINGS.sunCascadeRatioMax, count));
  const step = Math.pow(far / near, 1 / count);
  out[0] = camera;
  for (let i = 1; i <= count; i++) out[i] = near * Math.pow(step, i);
}

const splits = new Float64Array(LIGHT_SETTINGS.sunCascades + 1);
/** Ce dont `splits` dépend, tel qu'il était au dernier calcul : les deux distances de la vue et les
 *  trois réglages de la découpe. `pretes` distingue « jamais calculé » d'un `NaN` gardé. */
let pretes = false,
  vuNear = 0,
  vuFar = 0,
  vuCount = 0,
  vuFraction = 0,
  vuRatio = 0;

/**
 * Les bornes de la vue courante, recalculées seulement si la vue ou la découpe ont changé. Elles ne
 * dépendent ni de la face ni du soleil : les quatre cascades d'une image les partagent, là où
 * chacune refaisait les quatre `Math.pow` pour retrouver les mêmes nombres. `Object.is` compare,
 * donc `-0` et `NaN` sont traités comme le calcul les traiterait.
 */
function splitsDe(view: ShadowViewpoint) {
  const count = LIGHT_SETTINGS.sunCascades,
    fraction = LIGHT_SETTINGS.sunShadowFarFraction,
    ratio = LIGHT_SETTINGS.sunCascadeRatioMax;
  if (
    pretes &&
    Object.is(vuNear, view.near) &&
    Object.is(vuFar, view.far) &&
    vuCount === count &&
    Object.is(vuFraction, fraction) &&
    Object.is(vuRatio, ratio)
  )
    return splits;
  sunCascadeSplits(view, splits);
  pretes = true;
  vuNear = view.near;
  vuFar = view.far;
  vuCount = count;
  vuFraction = fraction;
  vuRatio = ratio;
  return splits;
}

const sphere = { distance: 0, radius: 0 };
const cascade: SunCascade = {
  center: [0, 0, 0],
  radius: 1,
  boxCenter: [0, 0, 0],
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
  if (k2 * (far + near) >= far - near) {
    sphere.distance = far;
    sphere.radius = far * Math.sqrt(k2);
    return sphere;
  }
  const span = far - near,
    sum = far + near;
  sphere.distance = 0.5 * sum * (1 + k2);
  sphere.radius =
    0.5 * Math.sqrt(span * span + 2 * (far * far + near * near) * k2 + sum * sum * k2 * k2);
  return sphere;
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
  const bornes = splitsDe(view);
  const { distance, radius } = frustumSphere(view, bornes[index], bornes[index + 1]);
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
  return cascade;
}
