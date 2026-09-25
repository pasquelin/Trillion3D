import { EngineError } from '../contracts/cache.ts';
import type { Geometry } from '../world/geometry/geometry.ts';
import { GRAVITY_PRESETS, type PhysicsOption } from './options.ts';
import { SOFT_VERTEX_WORDS } from './softLayout.ts';

/** A soft body: a cloth (its triangles, open), a rope (its vertices, each joined to the next), or
 *  a volume (its closed triangles, held up by the gas inside). */
export type SoftBodyType = 'cloth' | 'rope' | 'volume';

/** What `obj.physics` accepts for a soft body: its vertices are simulated one by one. */
export interface SoftBodyCommon {
  /** Indices of the geometry's vertices held where they are: a flag's pole, a rope's hook.
   *  @defaultValue [] */
  pins?: readonly number[];
  /** Kilograms, spread over the vertices by the area (a rope: the length) each one holds; left
   *  out, `SOFT_AREAL_DENSITY` per m² (a rope: `SOFT_LINEAR_DENSITY` per m). */
  mass?: number;
  /** How much an edge gives when pulled, m/N (the inverse of its stiffness): 0 never stretches.
   *  @defaultValue 0 */
  stretch?: number;
  /** How much it gives when folded, rad/(N·m) (a rope: m/N); `Infinity` folds freely.
   *  @defaultValue Infinity */
  bend?: number;
}
/** A volume's options: a closed mesh held up by the gas inside. */
export interface SoftVolumeOptions extends SoftBodyCommon {
  /** A volume. */ type: 'volume';
  /** The gas's pressure above the air's at rest, Pa; squeezed, it rises as the volume falls
   *  (Boyle's law). The triangles must face out. Left out, the pressure that rests the volume's
   *  weight on `SOFT_FOOTPRINT` of its mean cross-section. */
  pressure?: number;
}
/** A soft body's options: a cloth, a rope, or a volume with the pressure of its gas. */
export type SoftBodyOptions = (SoftBodyCommon & { type: 'cloth' | 'rope' }) | SoftVolumeOptions;

/** A medium woven cotton, kg/m²: textile weights run 0.15 to 0.25. A cloth falls the same at any
 *  mass; it weighs against its pins and what it meets. A volume's skin is taken as such a cloth. */
export const SOFT_AREAL_DENSITY = 0.2;
/** A 10 mm polyamide rope, kg/m: makers' tables give 0.06 to 0.07. */
export const SOFT_LINEAR_DENSITY = 0.065;
/**
 * Declared: the share of its mean cross-section — a quarter of its area, for any convex shape
 * (Cauchy) — a volume at rest on the ground sags onto, its gas pressing its weight there. Its
 * default pressure is then `4·m·g / (share·area)`: 31 Pa for a skin of `SOFT_AREAL_DENSITY`. Half
 * the share, twice the pressure. A pressure far above its weight's swells it past its rest shape:
 * each step moves a vertex by `pressure·dt² / (kg/m²)`, more than its edges then hold.
 */
export const SOFT_FOOTPRINT = 0.25;

/** A soft body's options once read: every default filled. */
export interface SoftSettings {
  /** What it is. */ type: SoftBodyType;
  /** The geometry's vertices held in place. */ pins: readonly number[];
  /** Kilograms, `undefined` for the default density's. */ mass: number | undefined;
  /** m/N. */ stretch: number;
  /** rad/(N·m), a rope's m/N. */ bend: number;
  /** Pa; `undefined` for a volume's default (`SOFT_FOOTPRINT`). */
  pressure: number | undefined;
}

const SOFT_TYPES: readonly string[] = ['cloth', 'rope', 'volume'];
/** Whether `type` names a soft body. */
export const isSoftType = (type: unknown): type is SoftBodyType =>
  SOFT_TYPES.includes(type as string);

/** The soft body `option` asks for, read; `null` when it asks for a rigid one. */
export const softOf = (option: PhysicsOption) =>
  typeof option === 'object' && isSoftType(option.type)
    ? softSettings(option as SoftBodyOptions)
    : null;

/** Reads a soft body's options, refusing a value out of its range. */
export function softSettings(o: SoftBodyOptions): SoftSettings {
  const { pins = [], mass, stretch = 0, bend = Infinity } = o;
  const pressure = o.type === 'volume' ? o.pressure : 0;
  for (const [name, value] of Object.entries({ stretch, bend, mass, pressure }))
    if (value !== undefined && !(value >= 0))
      throw new RangeError(`A soft body's ${name} is 0 and up: ${value}.`);
  return { type: o.type, pins: [...pins], mass, stretch, bend, pressure };
}

/** A soft body ready for the SOFT command, and how the geometry's vertices map onto its own. */
export interface SoftRecord {
  /** `x, y, z, mass` per simulated vertex, in the geometry's frame; a pin's mass is 0. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Each geometry vertex's simulated vertex: vertices at one position are one. */
  map: Uint32Array;
  /** The gas's pressure at rest, Pa; 0 without gas. */
  pressure: number;
}

type Scale = { x: number; y: number; z: number };

/**
 * The simulated vertices of `geometry`: those at one position welded into one (a sphere's seam
 * and poles would otherwise tear), their triangles (none for a rope: its vertices in order), and
 * their masses from the scaled area — a rope's length — each holds, or `settings.mass` spread so,
 * and a volume's pressure.
 */
export function softBodyOf(geometry: Geometry, scale: Scale, settings: SoftSettings): SoftRecord {
  const source = geometry.getAttribute('position')?.array ?? new Float32Array(0);
  const count = source.length / 3;
  const map = new Uint32Array(count);
  const at = new Map<string, number>();
  const kept: number[] = [];
  for (let v = 0; v < count; v++) {
    const key = `${source[v * 3]},${source[v * 3 + 1]},${source[v * 3 + 2]}`;
    let welded = at.get(key);
    if (welded === undefined) at.set(key, (welded = kept.push(v) - 1));
    map[v] = welded;
  }
  const corners = geometry.index ? geometry.index.array : Uint32Array.from(map.keys());
  const indices: number[] = [];
  if (settings.type !== 'rope')
    for (let t = 0; t + 2 < corners.length; t += 3) {
      const [a, b, c] = [map[corners[t]], map[corners[t + 1]], map[corners[t + 2]]];
      if (a !== b && b !== c && a !== c) indices.push(a, b, c);
    }
  if (settings.type === 'rope' ? kept.length < 2 : !indices.length)
    throw new EngineError('PHYSICS_FAILED', `A soft ${settings.type} needs more vertices.`);
  const vertices = new Float32Array(kept.length * SOFT_VERTEX_WORDS);
  kept.forEach((v, i) => vertices.set(source.subarray(v * 3, v * 3 + 3), i * SOFT_VERTEX_WORDS));
  const measure = spreadMass(vertices, indices, kept.length, scale);
  const density = settings.type === 'rope' ? SOFT_LINEAR_DENSITY : SOFT_AREAL_DENSITY;
  const factor = settings.mass === undefined ? density : settings.mass / measure;
  for (let i = 0; i < kept.length; i++) vertices[i * SOFT_VERTEX_WORDS + 3] *= factor;
  const pressure = settings.pressure ?? (4 * factor * GRAVITY_PRESETS.earth) / SOFT_FOOTPRINT;
  for (const pin of settings.pins) {
    if (!(Number.isInteger(pin) && pin >= 0 && pin < count))
      throw new RangeError(`A soft body's pin ${pin} names no vertex of its ${count}.`);
    vertices[map[pin] * SOFT_VERTEX_WORDS + 3] = 0;
  }
  return { vertices, indices: Uint32Array.from(indices), map, pressure };
}

/** Writes in each vertex's mass word the scaled area (no triangle: length) it holds; returns the
 *  whole. */
function spreadMass(vertices: Float32Array, indices: number[], count: number, s: Scale) {
  const p = (i: number, k: number) => vertices[i * SOFT_VERTEX_WORDS + k] * [s.x, s.y, s.z][k];
  const d = (a: number, b: number) => [0, 1, 2].map((k) => p(b, k) - p(a, k));
  const share = (corners: number[], amount: number) => {
    for (const i of corners) vertices[i * SOFT_VERTEX_WORDS + 3] += amount / corners.length;
    return amount;
  };
  let whole = 0;
  if (!indices.length)
    for (let i = 0; i + 1 < count; i++) whole += share([i, i + 1], Math.hypot(...d(i, i + 1)));
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const [u, v] = [d(a, b), d(a, c)];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    whole += share([a, b, c], Math.hypot(...cross) / 2);
  }
  if (!(whole > 0)) throw new EngineError('PHYSICS_FAILED', 'A soft body has no area or length.');
  return whole;
}
