import { MAX_HLOD_TEXTURE_SIZE, MIN_HLOD_TEXTURE_SIZE } from '../contracts/compilerAbi.ts'
import { flag, int } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The images a layer's atlas may bake beside the base colour, by field. */
const MAP_PROPERTIES = /* @__PURE__ */ (() =>
  ({
    normal: flag('The normal map (default true).'),
    roughness: flag('The roughness (default false).'),
    metallic: flag('The metallic (default false).'),
    specular: flag(
      "A merge or simplify layer's specular, in the red channel of the metal-roughness map (default false).",
    ),
    emissive: flag("A merge or simplify layer's emission map, over its strength (default false)."),
    opacity: flag(
      "A merge or simplify layer's opacity, the base image's alpha, the material drawn blended; not beside opacityMask (default false).",
    ),
    opacityMask: flag(
      "A merge or simplify layer's mask, the base image's alpha, the material drawn masked; not beside opacity (default false).",
    ),
    ambientOcclusion: flag("A merge layer's occlusion map, glTF's red channel (default false)."),
    anisotropy: flag(
      "A merge layer's anisotropy strength, the blue channel of its anisotropy image, which the runtime does not draw yet (default false).",
    ),
    tangent: flag(
      "A merge layer's tangent, the direction in the red and green channels of its anisotropy image, which the runtime does not draw yet (default false).",
    ),
  }) satisfies Record<string, JsonSchemaProperty>)()

/** The images a simplify layer's `maps` admits: those its transfer writes. */
const SIMPLIFY_MAPS = [
  'normal',
  'roughness',
  'metallic',
  'specular',
  'emissive',
  'opacity',
  'opacityMask',
] as const satisfies readonly (keyof typeof MAP_PROPERTIES)[]

/** The images a merge layer's `maps` admits: a simplify layer's and the three only it bakes. */
const MERGE_MAPS = /* @__PURE__ */ (() =>
  [
    ...SIMPLIFY_MAPS,
    'ambientOcclusion',
    'anisotropy',
    'tangent',
  ] as const satisfies readonly (keyof typeof MAP_PROPERTIES)[])()

/** The images of `fields`, as one builder's `maps` names them. */
const mapsOf = (
  fields: readonly (keyof typeof MAP_PROPERTIES)[],
  description: string,
): JsonSchemaProperty => ({
  type: 'object',
  description,
  properties: Object.fromEntries(fields.map((field) => [field, MAP_PROPERTIES[field]])),
})

/** A layer's `maps` for the two builders that share the property, each the fields its compiler's
 *  reader admits: a merge layer's, a simplify layer's (`HlodLayer.maps`). */
export const layerMaps: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description:
    "The images a merge or simplify layer's atlas bakes beside the base colour, a channel not baked the constant roughness 0.5 or metallic 0 (default the normal map alone). A simplify layer names the normal map, the roughness, the metallic, the specular, the emission, the opacity and the opacity mask; a merge layer all.",
  anyOf: [
    mapsOf(
      MERGE_MAPS,
      "A merge layer's images: the normal map, the roughness, the metallic, the specular, the emission, the opacity, the opacity mask, the occlusion, the anisotropy and the tangent.",
    ),
    mapsOf(
      SIMPLIFY_MAPS,
      "A simplify layer's images: the normal map, the roughness, the metallic, the specular, the emission, the opacity and the opacity mask; its transfer has no step for the occlusion, the anisotropy nor the tangent.",
    ),
  ],
}))()

/** One side of a `manual` atlas, `description` naming its map. */
const side = (description: string) => int(description, MIN_HLOD_TEXTURE_SIZE, MAX_HLOD_TEXTURE_SIZE)

/** A layer's `mapSizes` (`HlodLayer.mapSizes`). */
export const mapSizes: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description:
    "Each map's side in an approximate, merge or simplify layer's manual atlas, texels, 16 to 8192, rounded up to a power of two (default 1024 each). An approximate layer names base, normal, roughness, metallic, specular and emissive; a merge layer all eleven; a simplify layer those and opacity and opacityMask, its transfer writing no other. The packed images take the largest side of the maps they pack that the layer bakes: the base colour with opacity or opacityMask, the metal-roughness map with its three, the anisotropy map with the tangent.",
  properties: {
    base: side('The base colour.'),
    normal: side('The normal map.'),
    tangent: side("A merge layer's tangent."),
    roughness: side('The roughness.'),
    metallic: side('The metallic.'),
    anisotropy: side("A merge layer's anisotropy."),
    specular: side('The specular.'),
    emissive: side('The emission.'),
    opacity: side("A merge or simplify layer's opacity."),
    opacityMask: side("A merge or simplify layer's opacity mask."),
    ambientOcclusion: side("A merge layer's ambient occlusion."),
  },
}))()
