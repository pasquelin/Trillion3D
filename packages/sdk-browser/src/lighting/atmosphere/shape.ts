import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SKY_QUALITY_RULES,
  type SkyQualityValues,
} from '../../../../sdk-core/src/modules/sky/quality.ts'

/**
 * THE SHAPE OF THE AIR'S PASSES: what the quality settings of the atmosphere
 * (`packages/sdk-core/src/modules/sky/quality.ts`) make of its tables, its volumes and its
 * marches — their sizes, their sample counts and their caps, and which of the optional passes run.
 * A pure function of the settings (`airShapeOf`), so that the programs are written once for a
 * shape (`shapeConstants`) and the resources are made once for it, both made again only when the shape
 * (`airShapeKey`) differs from the last image's.
 *
 * The haze volume lives in a region of the light buffer of fixed size, so its cells are bounded:
 * a volume asked for past `AERIAL_CELLS_MAX` cells keeps its width and loses slices, and one whose
 * width alone passes the bound is narrowed.
 */

/** The cells of the haze volume the light buffer holds with four half floats each; a volume of
 *  four 32-bit floats a cell holds half as many. */
export const AERIAL_CELLS_MAX = 32768

/** The shape of the air: see `airShapeOf`. */
export interface AirShape {
  /** Whether a transmittance table is made; else the air answers all-clear (a white table). */
  readonly transmittance: {
    readonly width: number
    readonly height: number
    readonly samples: number
    readonly on: boolean
    readonly small: boolean
  }
  readonly multiScatter: {
    readonly width: number
    readonly height: number
    readonly samples: number
    readonly highQuality: boolean
  }
  /** The sky table seen from the eye: its size, its samples' minimum and the reference's cap
   *  (before the scale of the samples), the distance the samples reach their cap at, and whether
   *  the sky is read from it (else every sky pixel is marched). */
  readonly skyView: {
    readonly width: number
    readonly height: number
    readonly minSamples: number
    readonly maxSamples: number
    readonly distanceKm: number
    readonly fast: boolean
  }
  /** The march of a sky pixel (`skyView.fast` off): its samples and the distance for the cap. */
  readonly march: {
    readonly minSamples: number
    readonly maxSamples: number
    readonly distanceKm: number
  }
  /** The haze volume: cells across the screen, slices along the distance, the length it reaches
   *  (km), the most samples a slice takes (before the scale), whether surfaces read it (else they
   *  would be marched), whether a surface nearer than the haze's start skips the read, and whether
   *  a cell holds four 32-bit floats. */
  readonly aerial: {
    readonly width: number
    readonly slices: number
    readonly depthKm: number
    readonly samplesPerSlice: number
    readonly fastOnOpaque: boolean
    readonly depthTest: boolean
    readonly full: boolean
  }
  readonly distantSky: { readonly on: boolean; readonly altitudeKm: number }
  /** Whether the march reads the shadow of the air's lights (`SceneLight.shadowsAir`). */
  readonly shadows: boolean
}

/** The floor of a count of samples: a march takes at least one. */
const atLeastOne = (value: number) => Math.max(1, value)

/** The haze volume's size under the light buffer's bound. */
function aerialSize(settings: SkyQualityValues) {
  const full = settings.skyTablesFullPrecision
  const cells = full ? AERIAL_CELLS_MAX / 2 : AERIAL_CELLS_MAX
  const width = Math.min(settings.aerialWidth, Math.floor(Math.sqrt(cells)))
  const slices = Math.min(settings.aerialDepthSlices, Math.floor(cells / (width * width)))
  return { width, slices, full }
}

/** The shape the settings give the air. */
export function airShapeOf(settings: SkyQualityValues): AirShape {
  const aerial = aerialSize(settings)
  const skyMin = atLeastOne(settings.skyTableSamplesMin)
  return {
    transmittance: {
      width: settings.transmittanceWidth,
      height: settings.transmittanceHeight,
      samples: atLeastOne(settings.transmittanceSamples),
      on: settings.transmittanceTable,
      small: settings.transmittanceSmallFormat,
    },
    multiScatter: {
      width: settings.multiScatterWidth,
      height: settings.multiScatterHeight,
      samples: atLeastOne(settings.multiScatterSamples),
      highQuality: settings.multiScatterHighQuality,
    },
    skyView: {
      width: settings.skyTableWidth,
      height: settings.skyTableHeight,
      minSamples: skyMin,
      maxSamples: settings.skyTableSamplesMax,
      distanceKm: settings.skyTableDistanceToMaxSamplesKm,
      fast: settings.skyTableFast,
    },
    march: {
      minSamples: atLeastOne(settings.atmosphereSamplesMin),
      maxSamples: settings.atmosphereSamplesMax,
      distanceKm: settings.atmosphereDistanceToMaxSamplesKm,
    },
    aerial: {
      width: aerial.width,
      slices: aerial.slices,
      depthKm: settings.aerialDepthKm,
      samplesPerSlice: settings.aerialSamplesPerSlice,
      fastOnOpaque: settings.aerialFastOnOpaque,
      depthTest: settings.aerialDepthTest,
      full: aerial.full,
    },
    distantSky: {
      on: settings.distantSkyLightTable,
      altitudeKm: settings.distantSkyLightAltitudeKm,
    },
    shadows: settings.atmosphereSampleLightShadowMap,
  }
}

/** The shape of the settings' defaults: the programs' text for the checks, and the shape of an air
 *  whose quality was never set. */
export const DEFAULT_AIR_SHAPE: AirShape = /* @__PURE__ */ airShapeOf(
  resolveSettings(SKY_QUALITY_RULES, {}),
)

/** A string that tells two shapes apart: the same for shapes that make the same programs and
 *  resources. */
export const airShapeKey = (shape: AirShape) => JSON.stringify(shape)

/** A number as a WGSL float literal. */
const f32 = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`)

/**
 * The WGSL constants of a shape, declared ahead of the programs' own text: sizes of the tables,
 * counts of samples and the lengths the marches use, by name. A count is the reference's, the cap
 * of a march before the scale of the samples (`samplesMaxOf`, `opticsWgsl.ts`).
 */
export function shapeConstants({
  transmittance,
  multiScatter,
  skyView,
  march,
  aerial,
  distantSky,
}: AirShape) {
  const sliceKm = aerial.depthKm / aerial.slices
  return `
const TRANSMITTANCE_SIZE:vec2f=vec2f(${f32(transmittance.width)},${f32(transmittance.height)});
const TRANSMITTANCE_SAMPLES:f32=${f32(transmittance.samples)};
const MULTI_SCATTER_SIZE:vec2f=vec2f(${f32(multiScatter.width)},${f32(multiScatter.height)});
const MULTI_SCATTER_SAMPLES:f32=${f32(multiScatter.samples)};
const MULTI_SCATTER_HIGH:bool=${multiScatter.highQuality};
const SKY_VIEW_SIZE:vec2f=vec2f(${f32(skyView.width)},${f32(skyView.height)});
const SKY_VIEW_SAMPLES_MIN:f32=${f32(skyView.minSamples)};
const SKY_VIEW_SAMPLES_MAX:f32=${f32(skyView.maxSamples)};
const SKY_VIEW_DISTANCE_KM:f32=${f32(skyView.distanceKm)};
const MARCH_SAMPLES_MIN:f32=${f32(march.minSamples)};
const MARCH_SAMPLES_MAX:f32=${f32(march.maxSamples)};
const MARCH_DISTANCE_KM:f32=${f32(march.distanceKm)};
const AERIAL_WIDTH:u32=${aerial.width}u;
const AERIAL_SLICES:u32=${aerial.slices}u;
const AERIAL_DEPTH_KM:f32=${f32(aerial.depthKm)};
const AERIAL_SLICE_KM:f32=${f32(sliceKm)};
const AERIAL_SAMPLES_PER_SLICE:f32=${f32(aerial.samplesPerSlice)};
const AERIAL_FULL:bool=${aerial.full};
const AERIAL_DEPTH_TEST:bool=${aerial.depthTest};
const AERIAL_FAST_OPAQUE:bool=${aerial.fastOnOpaque};
const AERIAL_CELLS:u32=${aerial.width * aerial.width * aerial.slices}u;
const SKY_FAST:bool=${skyView.fast};
const DISTANT_SKY_ON:bool=${distantSky.on};
const DISTANT_SKY_ALTITUDE_KM:f32=${f32(distantSky.altitudeKm)};
`
}
