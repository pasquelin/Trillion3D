import {
  LIGHTMAP_BAKE_RULES as rules,
  LIGHTMAP_BAKE_VOLUMES,
  type LightmapBakeWire,
} from '../contracts/lightmapBakeAbi.ts'
import { ruleSchema } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The settings of the bake (`lightmapBakeOptions.ts`). Each one's kind and bounds are its rule's
 *  (`LIGHTMAP_BAKE_RULES`); the reference's lengths are in centimetres, ours in metres. */
const settings: Record<keyof LightmapBakeWire, JsonSchemaProperty> = /* @__PURE__ */ (() => ({
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
  automaticVolumeExpand: ruleSchema(
    rules.automaticVolumeExpand,
    `How far, in metres, the scene's box grows when no volume is named, so that probes on its surfaces lie inside (default ${rules.automaticVolumeExpand.default}).`,
  ),
  automaticVolumeLimit: ruleSchema(
    rules.automaticVolumeLimit,
    `The half-size, in metres, past which the scene's box is cut to a cube of that half-size around its centre when no volume is named (default ${rules.automaticVolumeLimit.default}).`,
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
}))()

/** The `lightmapBake` option (`lightmapBakeOptions.ts`, `resolveLightmapBake`). */
export const lightmapBake: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description:
    "Whether the compiled scene gets a volumetric lightmap — its indirect light baked in bricks, a sparse grid of spherical harmonics samples, by the path tracing the reference's GPU lightmapper runs — and how it is baked: true the reference's settings, false or none no bake, or an object naming the settings it changes. The sky light is not baked (no sky radiance reaches a compile job).",
  anyOf: [
    { type: 'boolean', description: 'true bakes with every default, false does not bake.' },
    { type: 'object', description: 'The settings.', properties: settings },
  ],
}))()
