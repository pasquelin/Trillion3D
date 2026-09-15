// Les lampes du banc, placées par une règle générique : aucune scène n'est nommée ici.
//
// La règle : une grille régulière dans l'emprise horizontale du modèle, à hauteur fixe au-dessus de
// son plancher, chaque lampe portant une portée déduite de la maille. Elle vaut pour n'importe quel
// modèle importé ; le banc ne sait rien d'Emerald, de la maison ni d'aucun autre jeu de mesure.

/** Plancher du modèle : le plan d'origine si la géométrie l'enjambe, sinon le bas de sa boîte. */
const floorOf = (bounds) => (bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y);

/**
 * `count` lampes ponctuelles sur une grille dans l'emprise du modèle. `shadows` dit si elles
 * projettent une ombre. Rend la liste que l'hôte passe telle quelle à `addLight`, plus la maille :
 * le mouvement d'une lampe s'exprime en fraction de maille, donc reste dans sa propre portée.
 */
function gridLights(bounds, count, shadows) {
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
      intensity: 40,
      // La portée couvre la maille et un peu plus : les portées se recouvrent comme dans une rue.
      range: cell * 0.75,
      castsShadow: shadows,
    });
  }
  return { lights, cell };
}

/** Le ciel sombre du mode contrat : sans lui, l'éclairage d'origine reste le seul à l'image. */
const NIGHT_ENVIRONMENT = { skyColor: [0.02, 0.025, 0.04], exposure: 1 };

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
 * Les lampes d'une exécution, ou `null` quand le banc n'en demande aucune : la liste posée par la
 * règle de grille, le ciel du mode contrat, et le plan de mouvement de la première lampe.
 */
export function benchLights(bounds, settings) {
  if (!settings.lights) return null;
  const { lights, cell } = gridLights(bounds, settings.lights, settings.lightShadows);
  const moving = settings.movingLight ? movingLightPlan(lights, cell) : null;
  return {
    lights,
    environment: NIGHT_ENVIRONMENT,
    moving,
    resume: {
      nombre: lights.length,
      ombres: settings.lightShadows,
      maille: cell,
      mobile: !!moving,
    },
  };
}
