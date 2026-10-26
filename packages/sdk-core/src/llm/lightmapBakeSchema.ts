import {
  LIGHTMAP_BAKE_RULES as rules,
  LIGHTMAP_BAKE_SKY,
  LIGHTMAP_BAKE_SKY_RULES as skyRules,
  LIGHTMAP_BAKE_VOLUMES,
  type LightmapBakeSky,
  type LightmapBakeWire,
} from '../contracts/lightmapBakeAbi.ts'
import { ruleSchema } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The settings of the sky light the bake shines (`LIGHTMAP_BAKE_SKY_RULES`), the sky light part's own. */
const skySettings: Record<keyof LightmapBakeSky, JsonSchemaProperty> = /* @__PURE__ */ (() => ({
  intensity: ruleSchema(
    skyRules.intensity,
    `The sky's radiance multiplier, over both hemispheres; the sky's radiance is held at 0 or more (default ${skyRules.intensity.default}).`,
  ),
  color: ruleSchema(
    skyRules.color,
    `The sky light's linear colour, three components, over both hemispheres (default ${skyRules.color.default}).`,
  ),
  lowerHemisphereColor: ruleSchema(
    skyRules.lowerHemisphereColor,
    `The linear colour of the cube under the horizon, three components, a fraction of the sky above it before the colour and the intensity apply (default ${skyRules.lowerHemisphereColor.default}: black).`,
  ),
  castShadows: ruleSchema(
    skyRules.castShadows,
    `Whether the sky is shadowed by the scene's geometry, which is what fills the layer of the sky's bent normal; false leaves the sky unshadowed and the file without that layer (default ${skyRules.castShadows.default}).`,
  ),
}))()

/** How densely the volume is sampled and how the irradiance cache is built. */
const DENSITY_AND_CACHE_SETTINGS = /* @__PURE__ */ (() =>
  ({
    detailCellSize: ruleSchema(
      rules.detailCellSize,
      `The size, in metres, of a cell of the volume at its finest level, used around geometry; halving it can multiply the memory by up to eight (default ${rules.detailCellSize.default}).`,
    ),
    qualityMultiplier: ruleSchema(
      rules.qualityMultiplier,
      `The multiple of giSamples that the paths a probe of the volume takes make (default ${rules.qualityMultiplier.default}).`,
    ),
    giSamples: ruleSchema(
      rules.giSamples,
      `The paths a probe takes for a unit of quality, across all bounces (default ${rules.giSamples.default}).`,
    ),
    maxRefinementLevels: ruleSchema(
      rules.maxRefinementLevels,
      `The levels of bricks the volume refines to around geometry, each four times coarser than the one below; the file names a brick's span in a byte, so at most 4 (default ${rules.maxRefinementLevels.default}).`,
    ),
    irradianceCaching: ruleSchema(
      rules.irradianceCaching,
      `Whether paths end in a cache of the radiance that leaves a surface after a first bounce: it brightens interiors and biases a little; off for an exterior scene (default ${rules.irradianceCaching.default}).`,
    ),
    irradianceCacheQuality: ruleSchema(
      rules.irradianceCacheQuality,
      `The passes that build the irradiance cache, before the passes that read it (default ${rules.irradianceCacheQuality.default}).`,
    ),
    irradianceCacheSpacing: ruleSchema(
      rules.irradianceCacheSpacing,
      `The size, in metres, of a cell of the irradiance cache; smaller is slower and more accurate (default ${rules.irradianceCacheSpacing.default}).`,
    ),
    irradianceCacheCornerRejection: ruleSchema(
      rules.irradianceCacheCornerRejection,
      `How near a hit may be, in cache cells, for the cache to be read there, which keeps it from leaking around corners (default ${rules.irradianceCacheCornerRejection.default}).`,
    ),
  }) satisfies Partial<Record<keyof LightmapBakeWire, JsonSchemaProperty>>)()

/** The size of the volume, the memory of its bricks, the boxes it covers and the sky it shines. */
const VOLUME_AND_SKY_SETTINGS = /* @__PURE__ */ (() =>
  ({
    automaticVolumeExpand: ruleSchema(
      rules.automaticVolumeExpand,
      `How far, in metres, the scene's box grows when no volume is named, so that probes on its surfaces lie inside (default ${rules.automaticVolumeExpand.default}).`,
    ),
    automaticVolumeLimit: ruleSchema(
      rules.automaticVolumeLimit,
      `The half-size, in metres, past which the scene's box is cut to a cube of that half-size around its centre when no volume is named (default ${rules.automaticVolumeLimit.default}).`,
    ),
    maximumBrickMemory: ruleSchema(
      rules.maximumBrickMemory,
      `The memory, in megabytes, the finest bricks may take where the volume is one piece (loadingCellSize 0): past it the bricks furthest from the geometry are dropped (default ${rules.maximumBrickMemory.default}).`,
    ),
    sphericalHarmonicSmoothing: ruleSchema(
      rules.sphericalHarmonicSmoothing,
      `How much the spherical harmonics of a sample are smoothed where highly directional light makes them ring, 0 none to 1 strong (default ${rules.sphericalHarmonicSmoothing.default}).`,
    ),
    loadingCellSize: ruleSchema(
      rules.loadingCellSize,
      `The size, in metres, of a cell of the grid the finest bricks stream by, the coarser bricks always loaded; 0 keeps the volume in one piece (default ${rules.loadingCellSize.default}).`,
    ),
    minBrickError: ruleSchema(
      rules.minBrickError,
      `The error under which a finest brick is dropped because the brick over it interpolates it, as the root mean square of its ambient light (default ${rules.minBrickError.default}).`,
    ),
    [LIGHTMAP_BAKE_VOLUMES]: {
      type: 'array',
      description:
        "The boxes the volume covers, each a lower then an upper corner in metres; none, the scene's own box.",
      items: {
        type: 'array',
        description: 'A lower then an upper corner.',
        items: {
          type: 'array',
          description: 'A corner: x, y, z.',
          items: { type: 'number', description: 'One component.' },
          minItems: 3,
          maxItems: 3,
        },
        minItems: 2,
        maxItems: 2,
      },
    },
    [LIGHTMAP_BAKE_SKY]: {
      description:
        "The stationary sky light the bake shines — a flat sky, as no captured sky reaches a compile job: true its defaults (a white sky of intensity 1 over a black lower hemisphere, casting shadows), false or none no sky, or an object of the settings it changes. It lights the bounces and fills the layer of the sky's bent normal, whose length is the sky's visibility; without it the file holds no such layer.",
      anyOf: [
        { type: 'boolean', description: 'true shines the default sky, false none.' },
        { type: 'object', description: 'The sky light.', properties: skySettings },
      ],
    },
  }) satisfies Partial<Record<keyof LightmapBakeWire, JsonSchemaProperty>>)()

/** The settings of the bake (`lightmapBakeOptions.ts`). Each one's kind and bounds are its rule's
 *  (`LIGHTMAP_BAKE_RULES`); the reference's lengths are in centimetres, ours in metres. */
const settings: Record<keyof LightmapBakeWire, JsonSchemaProperty> = /* @__PURE__ */ (() => ({
  ...DENSITY_AND_CACHE_SETTINGS,
  ...VOLUME_AND_SKY_SETTINGS,
}))()

/** The `lightmapBake` option (`lightmapBakeOptions.ts`, `resolveLightmapBake`). */
export const lightmapBake: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description:
    "Whether the compiled scene gets a volumetric lightmap — its indirect light baked in bricks, a sparse grid of spherical harmonics samples, by the path tracing the reference's GPU lightmapper runs — and how it is baked: true the reference's settings, false or none no bake, or an object naming the settings it changes. The sky light is shone only where `skyLight` names one (no captured sky reaches a compile job).",
  anyOf: [
    { type: 'boolean', description: 'true bakes with every default, false does not bake.' },
    { type: 'object', description: 'The settings.', properties: settings },
  ],
}))()
