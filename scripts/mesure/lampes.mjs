// Les lampes du banc, placées par une règle générique : aucune scène n'est nommée ici.
//
// La règle : une grille régulière dans l'emprise horizontale du modèle, à hauteur fixe au-dessus de
// son plancher, chaque lampe portant une portée déduite de la maille. Elle vaut pour n'importe quel
// modèle importé ; le banc ne sait rien du jeu de mesure qu'on lui donne, quel qu'il soit.

/** Intensité d'une ponctuelle du banc, faute de mieux : la valeur des lots précédents. */
const DEFAULT_INTENSITY = 40;

/** Plancher du modèle : le plan d'origine si la géométrie l'enjambe, sinon le bas de sa boîte. */
const floorOf = (bounds) => (bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y);

/**
 * `count` lampes ponctuelles sur une grille dans l'emprise du modèle. `shadows` dit si elles
 * projettent une ombre, `intensity` ce qu'elles émettent. Rend la liste que l'hôte passe telle
 * quelle à `addLight`, plus la maille : le mouvement d'une lampe s'exprime en fraction de maille,
 * donc reste dans sa propre portée.
 *
 * L'intensité est une option du banc et non une valeur de scène : sur un modèle dont la maille
 * fait des dizaines de mètres, l'indirect d'une ponctuelle à intensité de rue tombe sous le
 * quantum des huit bits de la capture, et l'écart à l'oracle n'a alors plus rien à mesurer. La
 * monter ne nomme aucune scène — c'est le même nombre pour tout modèle, choisi par l'opérateur.
 */
function gridLights(bounds, count, shadows, intensity) {
  if (count <= 0) return { lights: [], cell: 0 };
  const sx = Math.max(1e-3, bounds.max.x - bounds.min.x),
    sy = Math.max(0, bounds.max.y - bounds.min.y),
    sz = Math.max(1e-3, bounds.max.z - bounds.min.z);
  const columns = Math.max(1, Math.round(Math.sqrt((count * sx) / sz))),
    rows = Math.ceil(count / columns);
  const stepX = sx / columns,
    stepZ = sz / rows;
  const cell = Math.hypot(stepX, stepZ);
  // Hauteur d'un lampadaire : une fraction de la hauteur du modèle, jamais moins de deux mètres.
  const height = floorOf(bounds) + Math.max(2, sy * 0.04);
  const lights = [];
  for (let i = 0; i < count; i++) {
    const column = i % columns,
      row = Math.floor(i / columns);
    lights.push({
      id: `banc-lampe-${i}`,
      kind: 'point',
      position: [bounds.min.x + (column + 0.5) * stepX, height, bounds.min.z + (row + 0.5) * stepZ],
      color: [1, 0.96, 0.88],
      intensity,
      // La portée couvre la maille et un peu plus : les portées se recouvrent comme dans une rue.
      range: cell * 0.75,
      castsShadow: shadows,
    });
  }
  return { lights, cell };
}

/**
 * Le soleil du banc : une lampe directionnelle générique, la même pour n'importe quel modèle. Sa
 * direction descend vers le nord-est à environ 40° au-dessus de l'horizon — un après-midi
 * quelconque, choisi une fois et jamais par scène —, sa couleur est neutre, et elle projette une
 * ombre. Aucune valeur ici ne dépend du jeu de mesure qu'on donne au banc.
 */
const SUN = {
  id: 'banc-soleil',
  kind: 'directional',
  direction: [-0.5, -0.64, -0.58],
  color: [1, 0.97, 0.92],
  intensity: 3,
  castsShadow: true,
};

/**
 * Le mouvement d'une lampe, en fraction de maille : un petit cercle parcouru en `period` images.
 * La lampe reste dans sa maille, donc sa carte d'ombre voit toujours les mêmes objets — ce qu'on
 * mesure est le coût de la remise à jour, pas celui d'un changement d'occulteurs.
 */
function movingLightPlan(lights, cell) {
  if (!lights.length) return null;
  return { id: lights[0].id, origin: lights[0].position.slice(), radius: cell * 0.2, period: 60 };
}

/**
 * Les lampes d'une exécution, ou `null` quand le banc n'en demande aucune : la grille de ponctuelles,
 * le soleil si on l'a demandé, et le plan de mouvement de la première ponctuelle. Sans aucune lampe,
 * le moteur rend sa vue sans éclairage : c'est son comportement par défaut, pas une option du banc.
 */
export function benchLights(bounds, settings) {
  if (!settings.lights && !settings.sun) return null;
  const intensity = settings.lightIntensity ?? DEFAULT_INTENSITY;
  const { lights, cell } = gridLights(bounds, settings.lights, settings.lightShadows, intensity);
  const moving = settings.movingLight ? movingLightPlan(lights, cell) : null;
  const all = settings.sun ? [{ ...SUN, castsShadow: settings.lightShadows }, ...lights] : lights;
  return {
    lights: all,
    moving,
    resume: {
      nombre: all.length,
      ponctuelles: lights.length,
      soleil: settings.sun,
      ombres: settings.lightShadows,
      maille: cell,
      intensite: intensity,
      mobile: !!moving,
    },
  };
}
