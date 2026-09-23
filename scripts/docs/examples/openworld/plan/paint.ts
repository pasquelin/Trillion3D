/**
 * What colour the ground has at a point (#332). The shared rules come first — sea bed, beach,
 * snow above the snowline — then the ground layers of every region that blends there, mixed by
 * their biome weights, so a transition band fades from one ground to the other. A slope beyond
 * what a layer claims is bare rock. Then what the erosion left: rock where running water cut
 * into the ground, scree where loose material lies at its angle of repose, the region's
 * flat-ground soil where it lies on gentle ground, and the ground darkened where water runs.
 * Each surface's albedo varies by its measured natural range, driven by one noise value the
 * caller gives.
 *
 * Slope is the angle from horizontal as a fraction of a right angle: 0 flat, 1 vertical.
 */
import { WORLD, type GroundLayer, type RegionModule, type Surface } from './contract.ts';
import { landWeights, REGIONS } from './layout.ts';
import { fbm } from './noise.ts';
import { REPOSE } from './rivers.ts';
import { albedoSpread, DEFAULT_GROUND, SURFACE } from './surfaces.ts';

/** Steepest slope soil holds, as a slope fraction: the angle of repose. */
const SOIL = Math.atan(REPOSE) / (Math.PI / 2);
/** Steepest slope snow lies on: 45°, where it slides off as avalanches. */
const SNOW_SLOPE = 0.5;
/** The snowline: three quarters of the highest peak, waving by 150 m over a few kilometres. */
const SNOWLINE = WORLD.peak * 0.75;
/** Highest a beach reaches above sea level, metres: a storm swash. */
const BEACH = 2.5;
/**
 * Share of its visible albedo soil loses when saturated: about half (Lobell & Asner, "Moisture
 * Effects on Soil Reflectance", Soil Sci. Soc. Am. J. 66, 2002).
 */
const SATURATED_DARKENING = 0.5;

/**
 * What the erosion left at a point, each in [0, 1]: loose material and cut rock as shares of a
 * whole layer (one cell's rise at the angle of repose), running water as `ErosionFields.wet`.
 */
export type Weathering = { loose: number; cut: number; wet: number };

const fits = (layer: GroundLayer, height: number, slope: number) =>
  (layer.minHeight === undefined || height >= layer.minHeight) &&
  (layer.maxHeight === undefined || height <= layer.maxHeight) &&
  slope <= (layer.maxSlope ?? SOIL);

/** Linear RGB albedo in `out[0..2]`, roughness in `out[3]`; `noise` in [-1, 1]. */
export type GroundColour = (
  x: number,
  z: number,
  height: number,
  slope: number,
  noise: number,
  weathering: Weathering,
  out: Float64Array,
) => void;

export function groundColour(seed: number, regions: readonly RegionModule[]): GroundColour {
  const layers = REGIONS.map(
      (name) => regions.find((module) => module.name === name)?.ground ?? DEFAULT_GROUND[name],
    ),
    weights = new Float64Array(REGIONS.length);
  return (x, z, height, slope, noise, weathering, out) => {
    out.fill(0);
    const add = (surface: Surface, weight: number) => {
      const variation = weight * (1 + albedoSpread(surface) * noise);
      for (let c = 0; c < 3; c++) out[c] += surface.color[c] * variation;
      out[3] += surface.roughness * weight;
    };
    if (height < 0) return add(SURFACE.seabed, 1);
    if (height < BEACH) return add(SURFACE.sand, 1);
    if (height > SNOWLINE + 150 * fbm(seed, x / 3_000, z / 3_000, 2) && slope < SNOW_SLOPE)
      return add(SURFACE.snow, 1);
    // Rock bares where running water cut the ground. Loose material is scree only where it
    // lies at its angle of repose, the slope talus stands at (Carson & Kirkby, "Hillslope Form
    // and Process", 1972); below it, it is soil under the region's own ground.
    const { loose, cut, wet } = weathering,
      scree = slope >= SOIL ? loose : 0,
      rock = Math.max(cut * wet, scree),
      soil = Math.min(loose - scree, 1 - rock),
      natural = 1 - rock - soil;
    if (rock > 0) add(SURFACE.rock, rock);
    landWeights(x, z, weights);
    for (let region = 0; region < REGIONS.length; region++) {
      const weight = weights[region];
      if (weight <= 0) continue;
      const pick = (s: number) =>
        layers[region].find((layer) => fits(layer, height, s))?.surface ?? SURFACE.rock;
      if (natural > 0) add(pick(slope), weight * natural);
      if (soil > 0) add(pick(0), weight * soil);
    }
    for (let c = 0; c < 3; c++) out[c] *= 1 - SATURATED_DARKENING * wet;
  };
}
