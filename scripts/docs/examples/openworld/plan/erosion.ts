/**
 * The erosion the relief has been through (#332): the natural ground is sampled on one working
 * grid over the whole map, the water (`hydraulic.ts`) and the talus (`talus.ts`) wear it down,
 * and what changed is handed back as fields sampled bilinearly anywhere: the displacement the plan
 * adds to its natural relief, the loose material lying on the rock, the rock worn away under
 * it, and how much water ran over each point. Everything is derived from the grid cell and from the
 * relief the grid holds; the few rates that are not are declared where they stand.
 */
import type { Lake } from './carve.ts';
import { WORLD } from './contract.ts';
import { HEIGHT_SAMPLES } from './heights.ts';
import { advect, exchange, GRAVITY, outflow, type Field } from './hydraulic.ts';
import { REPOSE, type RiverCourse } from './rivers.ts';
import { creep, slide } from './talus.ts';
import { waterMask } from './waterMask.ts';

/**
 * Working cell, metres: twice the physics heights' spacing (31.25 m). The narrowest landform
 * the simulation makes is a channel one cell wide between two banks, one wavelength over two
 * cells; the height files sample that wavelength four times, twice the Nyquist rate, so the
 * ground the player walks on holds every gully the water cuts.
 */
export const EROSION_CELL = (2 * WORLD.tile) / HEIGHT_SAMPLES;
/**
 * Depth over which the shore blends land into sea, metres; the erosion never lowers land closer
 * to sea level than this, so the coastline stays where the relief put it.
 */
export const SHORE = 2;
const HALF = WORLD.size / 2;

type ErosionSettings = {
  /** Time step, seconds: the pipe model's stability bound. */
  dt: number;
  /** Cells a slope at the angle of repose needs to climb the whole relief. */
  span: number;
  steps: number;
  /** Rain per step, metres of water on every land cell. */
  rain: number;
  /** Share of the water that evaporates per step. */
  evaporation: number;
};

/**
 * The run's settings for a grid of cell `cell` over a relief `relief` metres high.
 * - `dt = √(l / 8g)`: with a pipe of cross-section l², one step moves at most an eighth of the
 *   head to each of four neighbours, half of it in all, so the water never overshoots.
 * - `steps = 2 · span`: the water front advances at most half a cell per step (that same bound),
 *   so a drop rained on the highest crest reaches the foot of the longest slope, `span` cells at
 *   the angle of repose, within the run.
 * - `evaporation = 1 / steps`: rain lives, on average, the time it needs to run that slope.
 * - `rain = l · tan(repose) / steps`: over the run each cell receives the height a stable slope
 *   rises across one cell — the finest relief the grid carries on soil. This is the run's time
 *   compression (a few minutes of simulated flow stand for the ages that cut the valleys); it is
 *   not derived from the terrain. Sensitivity: the depth of the cuts grows about with it.
 */
function erosionSettings(cell: number, relief: number): ErosionSettings {
  const span = Math.ceil(relief / (cell * REPOSE)),
    steps = 2 * span;
  return {
    dt: Math.sqrt(cell / (8 * GRAVITY)),
    span,
    steps,
    rain: (cell * REPOSE) / steps,
    evaporation: 1 / steps,
  };
}

export type Eroded = {
  /** The eroded ground, metres. */
  bed: Float32Array;
  /** The rock under the loose material: the lowest the ground has been, metres. */
  rock: Float32Array;
  /** Wetness in [0, 1]: the water that ran here against what the longest slope gathers. */
  wet: Float32Array;
};

/**
 * Erodes `heights`, a `side`² grid of cell `cell`, row-major. Cells at or below sea level, the
 * grid's border and the `still` cells (standing water) are sinks, left as they are.
 */
export function erode(
  heights: Float32Array,
  side: number,
  cell: number,
  still: (c: number) => boolean = () => false,
): Eroded {
  const count = side * side,
    array = () => new Float32Array(count),
    sea = new Uint8Array(count),
    floor = array();
  let relief = 0;
  for (let c = 0; c < count; c++) {
    const i = c % side,
      edge = i === 0 || i === side - 1 || c < side || c >= count - side;
    // The sea and the map's edge are sinks: the land goes on past the map and drains there.
    sea[c] = edge || heights[c] <= WORLD.seaLevel || still(c) ? 1 : 0;
    floor[c] = Math.min(heights[c], SHORE);
    relief = Math.max(relief, heights[c] - WORLD.seaLevel);
  }
  const settings = erosionSettings(cell, relief),
    [fw, fe, fn, fs, u, v] = [array(), array(), array(), array(), array(), array()],
    field: Field = {
      side,
      cell,
      dt: settings.dt,
      b: Float32Array.from(heights),
      d: array(),
      s: array(),
      carried: array(),
      fw,
      fe,
      fn,
      fs,
      u,
      v,
      rock: Float32Array.from(heights),
      floor,
      sea,
      discharge: array(),
    };
  for (let step = 0; step < settings.steps; step++) {
    outflow(field, settings.rain);
    exchange(field, settings.evaporation);
    advect(field);
    // The talus and the creep reuse the carried-sediment buffer, free until the next advection.
    slide(field, field.carried);
    creep(field, heights, field.carried);
  }
  // Mean unit discharge against what a slope `span` cells long gathers in steady rain (rain
  // rate × length): a stream draining the whole relief is 1, a cell's own rain 1 / span.
  const gathered = (settings.rain / settings.dt) * cell * settings.span * settings.steps,
    wet = field.discharge.map((sum) => Math.min(1, sum / gathered));
  return { bed: field.b, rock: field.rock, wet };
}

export type ErosionFields = {
  /** Eroded minus natural ground, metres. */
  displacement(x: number, z: number): number;
  /** Loose material (deposits, scree) over the rock, metres. */
  loose(x: number, z: number): number;
  /** Rock worn away below the natural ground, by the water or the slides, metres. */
  incision(x: number, z: number): number;
  /** How much water ran here, 0–1 (see `Eroded.wet`). */
  wet(x: number, z: number): number;
  /** The height a stable slope rises across one cell: the depth at which a layer is whole. */
  layer: number;
};

/** The standing and running water the erosion drains into. */
export type Waters = { lakes: readonly Lake[]; rivers: readonly RiverCourse[] };

/**
 * Samples `height` over the whole map on the working grid, erodes it with the `waters` as sinks,
 * and samples the result.
 */
export function erosionFields(
  height: (x: number, z: number) => number,
  waters: Waters = { lakes: [], rivers: [] },
): ErosionFields {
  const cell = EROSION_CELL,
    side = Math.round(WORLD.size / cell) + 1,
    natural = new Float32Array(side * side);
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) natural[j * side + i] = height(i * cell - HALF, j * cell - HALF);
  const still = waterMask(waters, side, cell),
    { bed, rock, wet } = erode(natural, side, cell, (c) => still[c] === 1),
    displacement = bed.map((value, c) => value - natural[c]),
    loose = bed.map((value, c) => value - rock[c]),
    incision = rock.map((value, c) => natural[c] - value),
    sample = (grid: Float32Array) => (x: number, z: number) => {
      const gx = Math.max(0, Math.min(side - 1, (x + HALF) / cell)),
        gz = Math.max(0, Math.min(side - 1, (z + HALF) / cell)),
        i = Math.min(side - 2, Math.floor(gx)),
        j = Math.min(side - 2, Math.floor(gz)),
        fx = gx - i,
        fz = gz - j,
        a = j * side + i;
      return (
        (grid[a] * (1 - fx) + grid[a + 1] * fx) * (1 - fz) +
        (grid[a + side] * (1 - fx) + grid[a + side + 1] * fx) * fz
      );
    };
  return {
    displacement: sample(displacement),
    loose: sample(loose),
    incision: sample(incision),
    wet: sample(wet),
    layer: cell * REPOSE,
  };
}
