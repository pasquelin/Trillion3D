import { surfaceFrontOnly, type PageSurface } from './pageSurface.ts';
import {
  CONE_LENGTH_RATIO,
  CONE_ORTHO_EPS,
  HALF_PI,
  boxConeRejects,
  linearPartScale,
  normalMatrix3,
} from '../sdk-core/index.ts';
import type { MatrixElements } from './matrixElements.ts';

export type NormalCone = { axis: [number, number, number]; angle: number };
/** Never rejects. */
export const OPEN_CONE: NormalCone = { axis: [0, 0, 1], angle: Math.PI };
export { triangleCone } from './pageConeBuild.ts';

const loneContext = createConeContext();

/**
 * Conformality of a transformation, independent of its scale: 3×3 matrix is divided by sum
 * of absolute values of its terms before squaring, then its 3 columns must have same
 * length and be orthogonal to 1e-4 in relative terms. Zero absolute tolerance: tiny scale
 * accepts no more deformation than unit scale. Zero, infinite, NaN 3×3 matrix, or zero column,
 * is non-conformal: cluster is retained.
 *  CPU mirror of `isConformal` (gpuDagShader.ts): same normalization, same tolerances (`mathCone.ts`).
 *  Scale comes from `linearPartScale` (`mathSingular.ts`), same sum singularity rule uses:
 *  same 9 terms, same order, so exact same bits as before.
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
  if (maxl > minl * CONE_LENGTH_RATIO) return false;
  const eps = maxl * CONE_ORTHO_EPS;
  return (
    Math.abs(x0 * y0 + x1 * y1 + x2 * y2) <= eps &&
    Math.abs(x0 * z0 + x1 * z1 + x2 * z2) <= eps &&
    Math.abs(y0 * z0 + y1 * z1 + y2 * z2) <= eps
  );
}

/**
 * What a cone culling test reads from root and camera that stays invariant across clusters:
 * transformation conformality, scale, normal matrix, camera world position. Set once per root
 * per frame, it removes 3×3 inverse-transpose, camera matrix decomposition, and conformality test
 * from per-cluster loop — per-cluster arithmetic changes by zero bits.
 *
 * `ready` indicates whether context already holds this root: a root with no cluster cones
 * never initializes it.
 */
export type ConeContext = {
  ready: boolean;
  conformal: boolean;
  scale: number;
  normal: Float64Array;
  camX: number;
  camY: number;
  camZ: number;
  /** 1 when `cam` is the eye, 0 when it is the direction back to an orthographic camera. */
  camW: number;
};

/** Reused context of a cut: selection is synchronous, like its `selectionScratch`. */
export function createConeContext(): ConeContext {
  return {
    ready: false,
    conformal: false,
    scale: 1,
    normal: new Float64Array(9),
    camX: 0,
    camY: 0,
    camZ: 0,
    camW: 1,
  };
}

/** Fills context for a root transform and the camera's homogeneous view point
 *  (`EngineCamera.viewPoint`); a three-component eye is a point. */
export function coneContextFor(into: ConeContext, world: MatrixElements, eye: ArrayLike<number>) {
  const e = world.elements;
  into.ready = true;
  into.conformal = isConformal(e);
  if (!into.conformal) return into;
  into.scale = Math.hypot(e[0], e[1], e[2]);
  normalMatrix3(into.normal, e);
  // The view point comes from the engine camera (`cam.viewPoint`): the frame sets it once.
  into.camX = eye[0];
  into.camY = eye[1];
  into.camZ = eye[2];
  into.camW = eye[3] ?? 1;
  return into;
}

/** Cluster cone culling, root context already initialized.
 *  CPU mirror of `coneRejectsBox` (gpuDagShader.ts): same tolerances (`mathCone.ts`), same
 *  operands, two languages — text is unshared, rule is shared. */
export function coneCullsPageWith(
  ctx: ConeContext,
  cone: NormalCone,
  world: MatrixElements,
  min: number[],
  max: number[],
  surface?: PageSurface,
): boolean {
  if (surface && !surfaceFrontOnly(surface)) return false;
  if (!ctx.conformal) return false;
  if (cone.angle >= HALF_PI) return false;
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
    ctx.camW,
  );
}

/** Same culling for a caller without context: sets one for this single cluster. */
export function coneCullsPage(
  cone: NormalCone,
  world: MatrixElements,
  min: number[],
  max: number[],
  eye: ArrayLike<number>,
  surface?: PageSurface,
): boolean {
  return coneCullsPageWith(coneContextFor(loneContext, world, eye), cone, world, min, max, surface);
}
