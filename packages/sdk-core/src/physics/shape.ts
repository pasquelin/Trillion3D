import type { Geometry } from '../world/geometry/geometry.ts';
import { SHAPE } from './layout.ts';
import type { PhysicsShape, PhysicsType } from './options.ts';

/** A shape ready for the ADD command: a primitive's sizes, or scaled vertices and indices. */
export interface ResolvedShape {
  shape: (typeof SHAPE)[keyof typeof SHAPE];
  size: [number, number, number];
  vertices?: Float32Array;
  indices?: Uint32Array;
  /** Triangles counted against `budget.physics.triangles`. */
  triangles: number;
}

type Scale = { x: number; y: number; z: number };

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

/** The geometry's positions scaled into the body's frame, and its triangle indices. */
function scaledMesh(geometry: Geometry, scale: Scale) {
  const source = geometry.getAttribute('position')?.array ?? new Float32Array(0);
  const vertices = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    vertices[i] = source[i] * scale.x;
    vertices[i + 1] = source[i + 1] * scale.y;
    vertices[i + 2] = source[i + 2] * scale.z;
  }
  const count = vertices.length / 3;
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count - (count % 3) }, (_, i) => i);
  return { vertices, indices };
}

/** A primitive the declared or inferred shape names exactly, or `null` when the scale bends it. */
function primitive(declared: PhysicsShape, s: Scale): ResolvedShape | null {
  const x = Math.abs(s.x),
    y = Math.abs(s.y),
    z = Math.abs(s.z);
  const round = same(x, z);
  if (declared.type === 'box') {
    const [a, b, c] = declared.halfExtents;
    return { shape: SHAPE.box, size: [a * x, b * y, c * z], triangles: 0 };
  }
  if (declared.type === 'sphere' && round && same(x, y))
    return { shape: SHAPE.sphere, size: [declared.radius * x, 0, 0], triangles: 0 };
  if (
    (declared.type === 'capsule' && round && same(x, y)) ||
    (declared.type === 'cylinder' && round)
  )
    return {
      shape: declared.type === 'capsule' ? SHAPE.capsule : SHAPE.cylinder,
      size: [declared.halfHeight * y, declared.radius * x, 0],
      triangles: 0,
    };
  return null;
}

/** The exact primitive a geometry was built as (`Geometry.recipe`), or `null`. */
export function recipeShape(geometry: Geometry): PhysicsShape | null {
  const recipe = geometry.recipe;
  if (!recipe) return null;
  const a = recipe.args as number[];
  if (recipe.type === 'box')
    return { type: 'box', halfExtents: [(a[0] ?? 1) / 2, (a[1] ?? 1) / 2, (a[2] ?? 1) / 2] };
  if (recipe.type === 'sphere') return { type: 'sphere', radius: a[0] ?? 1 };
  if (recipe.type === 'capsule')
    return { type: 'capsule', halfHeight: (a[1] ?? 1) / 2, radius: a[0] ?? 1 };
  if (recipe.type === 'cylinder' && (a[0] ?? 1) === (a[1] ?? 1))
    return { type: 'cylinder', halfHeight: (a[2] ?? 1) / 2, radius: a[0] ?? 1 };
  return null;
}

/**
 * The collision shape of a body: the declared one, else the primitive its geometry was built as
 * (box, sphere, capsule, cylinder — exact), else its triangles when static, else the convex hull of
 * its vertices, computed in the worker.
 */
export function resolveShape(
  geometry: Geometry,
  scale: Scale,
  type: PhysicsType,
  declared?: PhysicsShape,
): ResolvedShape {
  const wanted = declared ?? recipeShape(geometry);
  const exact = wanted && wanted.type !== 'triangles' && wanted.type !== 'hull';
  const found = exact ? primitive(wanted, scale) : null;
  if (found) return found;
  const triangles = wanted?.type === 'triangles' || (wanted?.type !== 'hull' && type === 'static');
  const { vertices, indices } = scaledMesh(geometry, scale);
  return triangles
    ? { shape: SHAPE.triangles, size: [0, 0, 0], vertices, indices, triangles: indices.length / 3 }
    : { shape: SHAPE.hull, size: [0, 0, 0], vertices, triangles: 0 };
}
