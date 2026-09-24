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
export const WATER_DENSITY = 1000;
/** Smallest half side of a piece's sample square, metres: a thin piece still reads a slope. */
const MIN_HALF = 0.05;

/** A body of water as the page declares it to the physics worker (structured-clone safe). */
export interface WaterSpec {
  waves: WaveSpec[];
  /** Height of the surface at rest, metres. */
  level: number;
  /** kg/m³ (`WATER_DENSITY` by default). */
  density?: number;
  /** Jolt's quadratic drag coefficient and its angular drag. */
  linearDrag?: number;
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
}

/** Resolves a declared water body. */
export function createWater(spec: WaterSpec): Water {
  return {
    waves: new Waves(spec.waves),
    level: spec.level,
    density: spec.density ?? WATER_DENSITY,
    linearDrag: spec.linearDrag ?? 0.5,
    angularDrag: spec.angularDrag ?? 0.05,
    current: spec.current ?? [0, 0, 0],
  };
}

/** Length past which a single primitive is cut into slices, each with its own plane: half the
 *  shortest wavelength (0 without waves: no slices). */
export function sliceLength(water: Water) {
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
        hx = Math.max(read[from + 4], MIN_HALF),
        hz = Math.max(read[from + 5], MIN_HALF);
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
