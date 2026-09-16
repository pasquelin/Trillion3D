import { boxConeRejects, linearPartScale, normalMatrix3 } from '../sdk-core/index.ts';
import * as THREE from 'three';
import type { EngineCamera } from './cameraWorld.ts';
import type { MatrixElements } from './matrixElements.ts';

export type NormalCone = { axis: [number, number, number]; angle: number };
/** Never rejects. */
export const OPEN_CONE: NormalCone = { axis: [0, 0, 1], angle: Math.PI };
export { triangleCone } from './pageConeBuild.ts';

const loneContext = createConeContext();

/**
 * Conformité d'une transformation, indépendante de son échelle : la 3×3 est divisée par la somme
 * des valeurs absolues de ses termes avant tout carré, puis ses trois colonnes doivent avoir la même
 * longueur et être orthogonales à 1e-4 près, en relatif. Aucune tolérance absolue : une échelle
 * minuscule n'accepte pas plus de déformation qu'une échelle unité. Une 3×3 nulle, infinie ou NaN,
 * ou une colonne nulle, n'est pas conforme : le cluster est conservé.
 *  Miroir CPU de `isConformal` (gpuDagShader.ts) : même normalisation, mêmes tolérances. L'échelle
 *  vient de `linearPartScale` (`mathSingular.ts`), la somme que la règle de singularité emploie déjà :
 *  mêmes neuf termes, même ordre, donc les mêmes bits qu'auparavant.
 */
function isConformal(e: ArrayLike<number>) {
  const t = linearPartScale(e);
  if (!(t > 0) || !Number.isFinite(t)) return false;
  const x0 = e[0] / t,
    x1 = e[1] / t,
    x2 = e[2] / t;
  const y0 = e[4] / t,
    y1 = e[5] / t,
    y2 = e[6] / t;
  const z0 = e[8] / t,
    z1 = e[9] / t,
    z2 = e[10] / t;
  const lx2 = x0 * x0 + x1 * x1 + x2 * x2,
    ly2 = y0 * y0 + y1 * y1 + y2 * y2,
    lz2 = z0 * z0 + z1 * z1 + z2 * z2;
  const maxl = Math.max(lx2, ly2, lz2),
    minl = Math.min(lx2, ly2, lz2);
  if (maxl > minl * 1.0001) return false;
  const eps = maxl * 1e-4;
  return (
    Math.abs(x0 * y0 + x1 * y1 + x2 * y2) <= eps &&
    Math.abs(x0 * z0 + x1 * z1 + x2 * z2) <= eps &&
    Math.abs(y0 * z0 + y1 * z1 + y2 * z2) <= eps
  );
}

/**
 * Ce qu'un rejet de cône lit d'une racine et de la caméra, et qui ne change pas d'un cluster à
 * l'autre : la conformité de la transformation, son échelle, sa matrice normale, la position monde
 * de la caméra. Posé une fois par racine et par image, il retire de la boucle par cluster une
 * inverse-transposée 3×3, une décomposition de matrice de caméra et le test de conformité —
 * l'arithmétique par cluster ne bouge pas d'un bit.
 *
 * `ready` dit si le contexte porte déjà cette racine : une racine dont aucun cluster n'a de cône ne
 * le fait jamais poser.
 */
export type ConeContext = {
  ready: boolean;
  conformal: boolean;
  scale: number;
  normal: Float64Array;
  camX: number;
  camY: number;
  camZ: number;
};

/** Le contexte réutilisé d'une coupe : la sélection est synchrone, comme son `selectionScratch`. */
export function createConeContext(): ConeContext {
  return {
    ready: false,
    conformal: false,
    scale: 1,
    normal: new Float64Array(9),
    camX: 0,
    camY: 0,
    camZ: 0,
  };
}

/** Remplit le contexte pour une transformation de racine et une caméra. */
export function coneContextFor(into: ConeContext, world: MatrixElements, cam: EngineCamera) {
  const e = world.elements;
  into.ready = true;
  into.conformal = isConformal(e);
  if (!into.conformal) return into;
  into.scale = Math.hypot(e[0], e[1], e[2]);
  normalMatrix3(into.normal, e);
  // La position monde de l'œil vient de la caméra du moteur : une image la pose une fois.
  into.camX = cam.eye[0];
  into.camY = cam.eye[1];
  into.camZ = cam.eye[2];
  return into;
}

/** Le rejet de cône d'un cluster, le contexte de sa racine étant déjà posé.
 *  Miroir CPU de `coneRejectsBox` (gpuDagShader.ts) : mêmes tolérances relatives 1.0001 et 1e-4,
 *  mêmes opérandes, deux langages — le texte ne se partage pas, la règle si. */
export function coneCullsPageWith(
  ctx: ConeContext,
  cone: NormalCone,
  world: MatrixElements,
  min: number[],
  max: number[],
  material?: THREE.Material | THREE.Material[],
): boolean {
  if (material) {
    const side = Array.isArray(material) ? material[0]?.side : material.side;
    if (side === THREE.DoubleSide || side === THREE.BackSide) return false;
  }
  if (!ctx.conformal) return false;
  if (cone.angle >= Math.PI / 2) return false;
  return boxConeRejects(
    cone.axis,
    cone.angle,
    min,
    max,
    world.elements,
    ctx.normal,
    ctx.scale,
    ctx.camX,
    ctx.camY,
    ctx.camZ,
  );
}

/** Le même rejet pour un appelant qui n'a pas de contexte : il en pose un pour ce seul cluster. */
export function coneCullsPage(
  cone: NormalCone,
  world: MatrixElements,
  min: number[],
  max: number[],
  cam: EngineCamera,
  material?: THREE.Material | THREE.Material[],
): boolean {
  return coneCullsPageWith(
    coneContextFor(loneContext, world, cam),
    cone,
    world,
    min,
    max,
    material,
  );
}
