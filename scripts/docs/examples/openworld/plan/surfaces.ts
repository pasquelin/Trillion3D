/**
 * The terrain's surfaces (#332): the ones every biome shares (sand, rock, snow, the sea, rivers,
 * roads) and a default ground per region for when its module is not given. Colours are linear
 * RGB, as glTF's base colour factor states them.
 *
 * A ground's brightness is not picked: it is the broadband albedo range the literature measures
 * for its kind of surface — T. R. Oke, "Boundary Layer Climates", 2nd ed. (1987), table 1.1 —
 * and its colour is a hue scaled so its luminance lands on the middle of that range. The range
 * itself is the natural variation the ground bake spreads that surface over.
 */
import type { GroundLayer, RegionName, RoadClass, Surface } from './contract.ts';

type Rgb = [number, number, number];
type Range = readonly [number, number];

/**
 * Albedo ranges, Oke (1987) table 1.1; rock is exposed granite, whose visible reflectance the
 * USGS spectral library (R. F. Kokaly et al., "USGS Spectral Library Version 7", 2017) puts
 * about 0.2–0.4, nearly flat across the visible — a grey, barely warm.
 */
export const ALBEDO = {
  freshSnow: [0.8, 0.95],
  desert: [0.2, 0.45],
  soil: [0.05, 0.4],
  wetSoil: [0.05, 0.15],
  longToShortGrass: [0.16, 0.26],
  tundra: [0.18, 0.25],
  coniferous: [0.05, 0.15],
  rock: [0.2, 0.4],
  asphalt: [0.05, 0.2],
} as const satisfies Record<string, Range>;

const spreadOf = ([low, high]: Range) => (high - low) / (high + low);

/** Relative half-spread of each ground's albedo range, by surface name. */
const SPREAD = new Map<string, number>();

/** Luminance of a linear RGB colour (ITU-R BT.709 weights). */
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * A ground surface `terrain/<name>`: `hue` scaled so its luminance lands mid-`range` (an albedo
 * range of `ALBEDO`), varied over that range by the bake.
 */
export const ground = (name: string, hue: Rgb, range: Range, roughness = 0.95): Surface => {
  const scale = (range[0] + range[1]) / 2 / luminance(hue);
  SPREAD.set(`terrain/${name}`, spreadOf(range));
  return {
    name: `terrain/${name}`,
    color: [...(hue.map((c) => c * scale) as Rgb), 1],
    metalness: 0,
    roughness,
  };
};

/** A plain surface whose colour is not an albedo reference: water, lit by its gloss. */
const water = (name: string, color: Rgb, roughness: number): Surface => ({
  name: `terrain/${name}`,
  color: [...color, 1],
  metalness: 0,
  roughness,
});

export const SURFACE = {
  sand: ground('sand', [0.62, 0.52, 0.36], ALBEDO.desert),
  seabed: ground('seabed', [0.33, 0.3, 0.22], ALBEDO.wetSoil),
  rock: ground('rock', [0.3, 0.29, 0.27], ALBEDO.rock),
  snow: ground('snow', [0.85, 0.87, 0.9], ALBEDO.freshSnow, 0.6),
  // Waiting on the engine: a water material (reflection, refraction, waves); until then the
  // sea, lakes and rivers are opaque, glossy surfaces.
  sea: water('sea', [0.02, 0.07, 0.11], 0.08),
  river: water('river', [0.03, 0.09, 0.1], 0.1),
  lake: water('lake', [0.02, 0.08, 0.1], 0.08),
  asphalt: ground('asphalt', [0.05, 0.05, 0.055], ALBEDO.asphalt, 0.8),
  dirt: ground('dirt', [0.3, 0.22, 0.14], ALBEDO.soil),
} as const;

/** A surface of no known range (a region's own palette) varies by the references' median. */
const MEDIAN_SPREAD = Object.values(ALBEDO)
  .map(spreadOf)
  .sort((a, b) => a - b)[Object.keys(ALBEDO).length >> 1];

/** The relative half-spread of a surface's albedo: how far natural variation moves it. */
export const albedoSpread = (surface: Surface) => SPREAD.get(surface.name) ?? MEDIAN_SPREAD;

/** The surface a road ribbon is drawn with. */
export const roadSurface = (cls: RoadClass): Surface =>
  cls === 'dirt' ? SURFACE.dirt : SURFACE.asphalt;

/** Ground layers per region when its module does not bring its own. */
export const DEFAULT_GROUND: Record<RegionName, readonly GroundLayer[]> = {
  mountains: [
    { surface: ground('alpine-meadow', [0.16, 0.22, 0.08], ALBEDO.tundra), minHeight: 1_800 },
    { surface: ground('pine-floor', [0.07, 0.11, 0.04], ALBEDO.coniferous) },
  ],
  desert: [
    {
      surface: ground('red-rock', [0.4, 0.17, 0.08], ALBEDO.desert),
      minHeight: 500,
      maxSlope: 0.6,
    },
    { surface: ground('dune', [0.7, 0.5, 0.28], ALBEDO.desert) },
  ],
  countryside: [
    { surface: ground('meadow', [0.14, 0.26, 0.06], ALBEDO.longToShortGrass), maxHeight: 400 },
    { surface: ground('upland', [0.2, 0.24, 0.1], ALBEDO.tundra) },
  ],
  city: [{ surface: ground('urban-lawn', [0.13, 0.2, 0.07], ALBEDO.longToShortGrass) }],
  airport: [{ surface: ground('dry-grass', [0.3, 0.28, 0.12], ALBEDO.longToShortGrass) }],
  coast: [
    {
      surface: ground('dune-grass', [0.35, 0.36, 0.18], ALBEDO.longToShortGrass),
      maxHeight: 20,
    },
    { surface: ground('heath', [0.18, 0.2, 0.09], ALBEDO.tundra) },
  ],
};
