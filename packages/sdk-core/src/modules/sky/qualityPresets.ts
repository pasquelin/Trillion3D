import type { SKY_QUALITY_RULES_BY_GROUP, SkyQualityValues } from './quality.ts'

/** The atmosphere's settings the three levels share. */
const BASE_EFFECTS = {
  aerialFastOnOpaque: true,
  skyTableFast: true,
  transmittanceSamples: 10,
  multiScatterSamples: 15,
} as const

/** What the presets below the top write, by quality group: the reference's levels 0, 1 and 2;
 *  `max`, the level 3, writes nothing (`runtime/qualityLevels.ts`); `cinematic` writes the fifth
 *  level. The effects levels write the atmosphere's eleven settings, the image effects' the light
 *  shafts' switch, the indirect light's the sky light's intensity factor. */
export const SKY_PRESET_LEVELS = {
  effects: {
    smooth: {
      ...BASE_EFFECTS,
      aerialSamplesPerSlice: 1,
      aerialDepthSlices: 8,
      skyTableSamplesMin: 2,
      skyTableSamplesMax: 16,
      atmosphereSamplesMin: 2,
      atmosphereSamplesMax: 16,
      transmittanceSmallFormat: true,
    },
    balanced: {
      ...BASE_EFFECTS,
      aerialSamplesPerSlice: 1,
      aerialDepthSlices: 16,
      skyTableSamplesMin: 4,
      skyTableSamplesMax: 32,
      atmosphereSamplesMin: 4,
      atmosphereSamplesMax: 32,
      transmittanceSmallFormat: false,
    },
    fine: {
      ...BASE_EFFECTS,
      aerialSamplesPerSlice: 2,
      aerialDepthSlices: 16,
      skyTableSamplesMin: 4,
      skyTableSamplesMax: 64,
      atmosphereSamplesMin: 4,
      atmosphereSamplesMax: 64,
      transmittanceSmallFormat: false,
    },
    // The fifth level marches the sky and the haze on the opaque surfaces instead of reading their
    // tables, with more samples and finer tables.
    cinematic: {
      aerialFastOnOpaque: false,
      skyTableFast: false,
      transmittanceSamples: 30,
      multiScatterSamples: 20,
      aerialSamplesPerSlice: 8,
      aerialDepthSlices: 32,
      skyTableSamplesMin: 4,
      skyTableSamplesMax: 256,
      atmosphereSamplesMin: 8,
      atmosphereSamplesMax: 256,
      transmittanceSmallFormat: false,
    },
  },
  imageEffects: {
    smooth: { lightShafts: false },
    balanced: { lightShafts: false },
    fine: { lightShafts: true },
    cinematic: { lightShafts: true },
  },
  indirectLight: {
    smooth: { skyLightIntensityScale: 0.8 },
    balanced: { skyLightIntensityScale: 1 },
    fine: { skyLightIntensityScale: 1 },
    cinematic: { skyLightIntensityScale: 1 },
  },
} as const satisfies Record<
  keyof typeof SKY_QUALITY_RULES_BY_GROUP,
  Record<string, Partial<SkyQualityValues>>
>
