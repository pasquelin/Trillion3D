/**
 * The water planes of one physics step. The module lists the pieces of the bodies that reach the
 * water (`jolt_water_query`: `WATER_PIECE_WORDS` each); here each piece gets the wave model's
 * exact height at its centre and the slope of four surface points around it, and the step's
 * BUOYANCY command carries every plane to the module, which pushes the bodies in one batched call.
 * A body floats on its own when its density is below the water's: the push is the water's weight
 * displaced, and Jolt measures the displaced volume exactly.
 */
import { BUOYANCY_WORDS, OP, PLANE_WORDS, WATER_PIECE_WORDS } from '../physics/layout.ts';
import { wavePatch, waveRest } from './surface.ts';
import { Waves, type WaveSpec } from './waves.ts';

/** Fresh water, kg/m³. */
const WATER_DENSITY = 1000;
/**
 * Declared drags, Jolt's quadratic coefficients (`Body::ApplyBuoyancyImpulse`). The linear one is
 * a drag coefficient: 0.5 is a sphere's (0.47), between a streamlined body (0.04) and a cube face
 * on (1.05). The angular one damps a body's turning in the water. Neither changes where a body
 * floats — the depth at rest follows from the densities alone — only how fast it settles there
 * and how fast a current carries it: doubling one roughly halves the time a body takes to settle.
 */
const LINEAR_DRAG = 0.5,
  ANGULAR_DRAG = 0.05;
/**
 * Slices per smallest sample square. A piece's plane is fitted over a square of its own half
 * sides, never smaller than the slice length over this: the fitted slope is the tangent's times
 * `sin(kh) / kh`, so at `kh = π / 25` a thin piece reads the shortest wave's slope within 0.3 %,
 * the longer waves' closer still. Sensitivity: only pieces thinner than that square see it.
 */
const SAMPLES_PER_SLICE = 25;

/** A body of water the bodies float in, as `world.physics.water` takes it. */
export interface WaterSpec {
  /** The Gerstner waves of the surface; none for still water. */
  waves: WaveSpec[];
  /** Height of the surface at rest, metres. */
  level: number;
  /** kg/m³; fresh water's 1000 by default. */
  density?: number;
  /** Quadratic drag coefficient: how fast a body settles, never where; 0.5 by default. */
  linearDrag?: number;
  /** How much the water damps a body's turning; 0.05 by default. */
  angularDrag?: number;
  /** Velocity of the water (a river's current), m/s. */
  current?: readonly [number, number, number];
}

/** A water body ready for the steps: its wave model and its resolved settings. */
export interface Water {
  waves: Waves;
  level: number;
  density: number;
  linearDrag: number;
  angularDrag: number;
  current: readonly [number, number, number];
  /** Smallest half side of a piece's sample square, metres (`SAMPLES_PER_SLICE`). */
  sample: number;
}

/** Resolves a declared water body. */
export function createWater(spec: WaterSpec): Water {
  const waves = new Waves(spec.waves);
  return {
    waves,
    level: spec.level,
    density: spec.density ?? WATER_DENSITY,
    linearDrag: spec.linearDrag ?? LINEAR_DRAG,
    angularDrag: spec.angularDrag ?? ANGULAR_DRAG,
    current: spec.current ?? [0, 0, 0],
    // Level water has a level plane over any square: its size is then free, 1 m.
    sample: sliceLength({ waves }) / SAMPLES_PER_SLICE || 1,
  };
}

/** Length past which a single primitive is cut into slices, each with its own plane: half the
 *  shortest wavelength (0 without waves: no slices). */
export function sliceLength(water: Pick<Water, 'waves'>) {
  let shortest = Infinity;
  for (let i = 0; i < water.waves.count; i++)
    if (water.waves.amplitude[i] > 0) shortest = Math.min(shortest, Math.PI / water.waves.k[i]);
  return Number.isFinite(shortest) ? shortest : 0;
}

/**
 * The words of a step: its BUOYANCY command, then the page's commands. Its buffer grows to the
 * largest step and is then reused: a steady step allocates nothing.
 */
export class StepWords {
  words = new Uint32Array(1024);
  private floats = new Float32Array(this.words.buffer);
  private readonly point = new Float64Array(3);
  private readonly corners = new Float64Array(12);

  private reserve(count: number) {
    if (count <= this.words.length) return;
    this.words = new Uint32Array(2 ** Math.ceil(Math.log2(count)));
    this.floats = new Float32Array(this.words.buffer);
  }

  /** Writes the planes of `count` pieces (`read`, the module's list) at the waves' current
   *  time, then `queued`; returns the word count. */
  write(water: Water, read: Float32Array, count: number, queued: Uint32Array | null) {
    this.reserve(BUOYANCY_WORDS + count * PLANE_WORDS + (queued?.length ?? 0));
    const w = this.words,
      f = this.floats,
      ids = new Uint32Array(read.buffer, read.byteOffset, read.length);
    w[0] = OP.buoyancy;
    w[1] = count;
    f[2] = water.density;
    f[3] = water.linearDrag;
    f[4] = water.angularDrag;
    f.set(water.current, 5);
    for (let i = 0; i < count; i++) {
      const from = i * WATER_PIECE_WORDS,
        to = BUOYANCY_WORDS + i * PLANE_WORDS;
      const x = read[from + 2],
        z = read[from + 3],
        hx = Math.max(read[from + 4], water.sample),
        hz = Math.max(read[from + 5], water.sample);
      // The exact height at the centre; the slope from the surface points the rest square
      // around the centre's rest point is carried to (their two diagonals' cross product).
      const waves = water.waves,
        p = this.point,
        corner = this.corners;
      waveRest(waves, x, z, p);
      const y = wavePatch(waves, p[0], p[2], hx, hz, corner);
      // (P₂ − P₁) × (P₃ − P₀): upwards for the square (−,−), (+,−), (−,+), (+,+).
      const ax = corner[6] - corner[3],
        ay = corner[7] - corner[4],
        az = corner[8] - corner[5],
        bx = corner[9] - corner[0],
        by = corner[10] - corner[1],
        bz = corner[11] - corner[2];
      const nx = ay * bz - az * by,
        ny = az * bx - ax * bz,
        nz = ax * by - ay * bx,
        length = Math.hypot(nx, ny, nz);
      w[to] = ids[from];
      w[to + 1] = ids[from + 1];
      f[to + 2] = x;
      f[to + 3] = water.level + y;
      f[to + 4] = z;
      f[to + 5] = nx / length;
      f[to + 6] = ny / length;
      f[to + 7] = nz / length;
    }
    let length = BUOYANCY_WORDS + count * PLANE_WORDS;
    if (queued) w.set(queued, (length += queued.length) - queued.length);
    return length;
  }
}
