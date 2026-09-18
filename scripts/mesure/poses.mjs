// Trajectoire du banc, vues et poses. C'est ici que la trajectoire est définie : le dépôt est sa
// source, et tout hôte qui veut rejouer le même banc la recopie d'ici. `PATH_VERSION` monte à chaque
// changement des points, pour que deux relevés ne se comparent qu'à trajectoire égale.
const PATH_VERSION = 5;
const POINTS = [
  [0.72, 28, 0.78],
  [0.2, 8, 0.26],
  [0.05, 1.2, 0.08],
  [-0.08, 1.7, 0.12],
  [-0.03, 1.5, 0.04],
  [-0.03, 1.5, 0.04],
  [0.3, 10, -0.26],
  [-0.38, 8, -0.36],
  [-0.48, 12, 0.46],
  [0.72, 28, 0.78],
];
const FRAMES_PER_SEGMENT = 60;
export { PATH_VERSION };

/** Les vues du banc que ce harnais sait jouer, par indice dans la trajectoire. */
export const VIEWS = {
  generale: { index: 0, segment: 'Vue générale du modèle' },
  sol: { index: 2 * FRAMES_PER_SEGMENT, segment: 'Déplacement au niveau de référence' },
  // Même segment que `sol`, au point le plus bas de la trajectoire : caméra dans la rue.
  rue: { index: 2 * FRAMES_PER_SEGMENT + 30, segment: 'Déplacement au niveau de référence' },
  detail: { index: 4 * FRAMES_PER_SEGMENT, segment: 'Gros plan sur une géométrie détaillée' },
};

/**
 * Plancher du modèle, `streetLevel` du banc : le plan d'origine si la géométrie l'enjambe, sinon le
 * bas de sa boîte. La caméra s'y pose et les lampes s'y accrochent — une seule règle pour les deux.
 */
export const plancherDuModele = (bounds) =>
  bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;

/** La pose du banc à l'indice `index`, calculée comme `urbanPath` la calcule. */
export function poseAt(bounds, index) {
  const min = bounds.min,
    max = bounds.max;
  const cx = (min.x + max.x) / 2,
    cz = (min.z + max.z) / 2;
  const sx = max.x - min.x,
    sy = max.y - min.y,
    sz = max.z - min.z;
  const radius = Math.hypot(sx, sy, sz) / 2;
  const ground = plancherDuModele(bounds),
    block = Math.max(sx, sz);
  const eye = Math.max(block * 0.008, sy > 0 ? Math.min(2, sy * 0.03) : 1.6);
  const segment = Math.floor(index / FRAMES_PER_SEGMENT),
    frame = index % FRAMES_PER_SEGMENT;
  const t = frame / (FRAMES_PER_SEGMENT - 1);
  const a = POINTS[segment],
    b = POINTS[segment + 1] ?? POINTS[0];
  const p = a.map((v, i) => v + (b[i] - v) * t);
  return {
    position: [cx + p[0] * sx, Math.max(ground + eye, ground + p[1] * eye), cz + p[2] * sz],
    target: [cx, ground + eye * 2, cz],
    fov: 55,
    near: Math.max(radius / 10000, 0.01),
    far: radius * 20,
  };
}
