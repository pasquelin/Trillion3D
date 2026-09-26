import { EngineError } from '../contracts/cache.ts';
import { Matrix4 } from '../world/math/matrix4.ts';
import type { CookedBody, CookedMass, ImplicitShape } from './cooked.ts';
import { SHAPE } from './layout.ts';
import type { PhysicsPrimitive } from './options.ts';
import { primitive, type ResolvedShape } from './shape.ts';

type Scale = { x: number; y: number; z: number };

/** A `KHR_implicit_shapes` shape as the page's primitives name it, sizes the extension leaves out
 *  at its defaults; `null` for a shape Jolt has no primitive of (a capsule that tapers). */
function implicitPrimitive(s: ImplicitShape): PhysicsPrimitive | null {
  if (s.type === 'box') {
    const [x, y, z] = s.box?.size ?? [1, 1, 1];
    return { type: 'box', halfExtents: [x / 2, y / 2, z / 2] };
  }
  if (s.type === 'sphere') return { type: 'sphere', radius: s.sphere?.radius ?? 0.5 };
  const rounded = s.type === 'capsule' ? s.capsule : s.cylinder;
  const { height = 0.5, radiusTop = 0.25, radiusBottom = 0.25 } = rounded ?? {};
  if (s.type === 'cylinder')
    return { type: 'cylinder', halfHeight: height / 2, radius: radiusTop, radiusBottom };
  return radiusTop === radiusBottom
    ? { type: 'capsule', halfHeight: height / 2, radius: radiusTop }
    : null;
}

/**
 * The shape of the body node `body` declares, placed at world scale `scale`, in Jolt's terms: its
 * implicit shape's primitive, or its cooked hull scaled. A shape Jolt makes no primitive of, or one
 * the scale bends (a sphere stretched), is refused by name: the body has no hull to fall back on.
 */
export function declaredShape({ node, shape }: CookedBody, scale: Scale): ResolvedShape {
  if (shape.type === 'cooked')
    return { shape: SHAPE.cooked, size: [scale.x, scale.y, scale.z], triangles: 0 };
  const declared = implicitPrimitive(shape);
  const found = declared && primitive(declared, scale);
  if (found) return found;
  throw new EngineError(
    'PHYSICS_FAILED',
    `The body of node ${node} declares a ${shape.type} Jolt cannot make at scale ${scale.x}, ${scale.y}, ${scale.z}.`,
    { node },
  );
}

/** `m`, weighed at one scale, as the same solid weighs at `r` times it. */
function rescaled({ mass, centerOfMass, inertia }: CookedMass, r: readonly number[]) {
  const k = Math.abs(r[0] * r[1] * r[2]);
  // The second moments, tr(I) / 2 − I, scale as their two axes; the inertia is tr − them again.
  const half = (inertia[0] + inertia[4] + inertia[8]) / 2;
  const moments = inertia.map((v, n) => ((n % 4 ? 0 : half) - v) * k * r[n % 3] * r[(n / 3) | 0]);
  const trace = moments[0] + moments[4] + moments[8];
  return {
    mass: mass * k,
    centerOfMass: centerOfMass.map((c, i) => c * r[i]),
    inertia: moments.map((v, n) => (n % 4 ? 0 : trace) - v),
  };
}

/** The inertia whose principal moments `d` turn by `q`: R diag(d) Rᵀ, nine, column-major. */
function turned(d: readonly number[], [x, y, z, w]: readonly number[] = [0, 0, 0, 1]) {
  const e = new Matrix4().makeRotationFromQuaternion({ x, y, z, w }).elements;
  const at = (row: number, col: number) =>
    e[row] * d[0] * e[col] + e[4 + row] * d[1] * e[4 + col] + e[8 + row] * d[2] * e[8 + col];
  return Array.from({ length: 9 }, (_, n) => at(n % 3, (n / 3) | 0));
}

/**
 * The mass of the body `body` declares, placed at world scale `scale`, and its mass frame (the
 * ADD command's `massFrame`): what its `motion` declares — `mass`, `centerOfMass` (in the node's
 * frame, stretched by `scale` as its shape is), `inertiaDiagonal` turned by `inertiaOrientation` —
 * wins over the cooked weighing, which is taken from the scale it was cooked at to `scale`, its
 * inertia to a declared mass. Nothing declared nor cooked, a mass of 0: Jolt weighs the shape at
 * its matter's density.
 */
export function declaredMass({ motion, shape, scale: cookedAt }: CookedBody, scale: Scale) {
  const s = [scale.x, scale.y, scale.z],
    r = s.map((v, i) => v / cookedAt[i]);
  const cooked = shape.type === 'cooked' && shape.mass ? rescaled(shape.mass, r) : null;
  const mass = motion.mass ?? cooked?.mass ?? 0;
  const inertia = motion.inertiaDiagonal
    ? turned(motion.inertiaDiagonal, motion.inertiaOrientation)
    : cooked?.inertia.map((v) => (v * mass) / cooked.mass);
  const declared = motion.centerOfMass?.map((c, i) => c * s[i]);
  const centre = declared ?? cooked?.centerOfMass ?? (inertia && [0, 0, 0]);
  return { mass, massFrame: centre && [...centre, ...(inertia ?? [])] };
}
