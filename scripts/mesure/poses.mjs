// Trajectoire du banc, vues et poses, recopiées du Lab et vérifiées contre lui à chaque exécution.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LAB = '/Users/pasquelin/Applications/render-tech-lab';

// Copie littérale de `urbanPath` / `streetLevel` de `render-tech-lab/src/lab/modelCampaign.ts`
// (pathVersion 5). Le Lab n'est pas importable ici : son module est en TypeScript et tire tout le
// banc 15 avec lui. La copie est donc vérifiée contre la source à chaque exécution, et le harnais
// refuse de mesurer si elle a bougé.
const PATH_VERSION = 5;
const POINTS_SOURCE =
  ' const points=[[.72,28,.78],[.2,8,.26],[.05,1.2,.08],[-.08,1.7,.12],[-.03,1.5,.04],[-.03,1.5,.04],[.3,10,-.26],[-.38,8,-.36],[-.48,12,.46],[.72,28,.78]];';
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

/** Refuse de mesurer si la trajectoire du banc a changé sous la copie ci-dessus. */
export function checkLabPath() {
  const source = readFileSync(join(LAB, 'src/lab/modelCampaign.ts'), 'utf8');
  const version = source.match(/export const pathVersion\s*=\s*(\d+)/);
  const points = source.split('\n').find((line) => line.includes('const points=[['));
  if (!version || Number(version[1]) !== PATH_VERSION)
    throw new Error(
      `trajectoire du banc en version ${version ? version[1] : '?'} et non ${PATH_VERSION} : recopier urbanPath`,
    );
  if (points !== POINTS_SOURCE)
    throw new Error('les points de la trajectoire du banc ont changé : recopier urbanPath');
  const names = source.match(/export const segmentNames=\[([^\]]*)\]/);
  for (const view of Object.values(VIEWS))
    if (names && !names[1].includes(view.segment))
      throw new Error(`le segment « ${view.segment} » n'existe plus dans le banc`);
}

/** `streetLevel` du banc : plan d'origine si la géométrie l'enjambe, sinon le plancher de l'AABB. */
const streetLevel = (bounds) => (bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y);

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
  const ground = streetLevel(bounds),
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
