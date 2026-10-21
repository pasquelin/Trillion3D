import {
  DEFAULT_HLOD_ACCURACY,
  DEFAULT_HLOD_CELL_SIZE,
  DEFAULT_HLOD_DEVIATION,
  DEFAULT_HLOD_EMPTY_TEXELS,
  DEFAULT_HLOD_LOADING_RANGE,
  DEFAULT_HLOD_TEXTURE_SIZE,
  DEFAULT_HLOD_TRANSLUCENCY,
  HLOD_BUILDERS,
  HLOD_EMPTY_TEXELS,
  HLOD_LOD_SELECTIONS,
  HLOD_MERGE_UV_METHODS,
  HLOD_TRANSLUCENCIES,
  MAX_HLOD_TEXTURE_SIZE,
  MIN_HLOD_TEXTURE_SIZE,
} from '../contracts/compilerAbi.ts'
import { approximation } from './hlodApproximationSchema.ts'
import { layerMaps, mapSizes } from './hlodMapsSchema.ts'
import { simplifySettings } from './hlodSimplifySchema.ts'
import { hlodMeshBuild } from './meshBuildSchema.ts'
import { choiceOrFlag, flag, int, num, positive } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `layers` of the expert form: one property for each setting of `HlodLayer`. */
export const hlodLayers: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'array',
  description: 'Expert form: the layers.',
  items: {
    type: 'object',
    description:
      "One layer. A builder refuses the settings of another; a merge layer's atlas settings need mergeMaterials, a sizing's setting its sizing.",
    required: ['name', 'builder'],
    properties: {
      name: { type: 'string', description: 'Unique name.' },
      builder: { type: 'string', enum: HLOD_BUILDERS, description: 'How it builds its actors.' },
      parent: {
        type: 'string',
        description:
          "The layer its cells' actors are built by; none at a chain's top. An instanced layer, or a merge layer keeping its materials, builds nothing above a layer whose actors wear materials of their own.",
      },
      accuracy: positive(
        `An approximate layer's voxel, metres, whatever the distance it is first seen from (default ${DEFAULT_HLOD_ACCURACY}).`,
      ),
      deviation: positive(
        `An approximate layer's geometric deviation, metres: what its shell is simplified within (default ${DEFAULT_HLOD_DEVIATION}).`,
      ),
      textureSize: int(
        `The atlas side of an approximate layer, or of a merge layer merging its materials or a simplify layer sized fixed or biased, a power of two (default ${DEFAULT_HLOD_TEXTURE_SIZE}).`,
        MIN_HLOD_TEXTURE_SIZE,
        MAX_HLOD_TEXTURE_SIZE,
      ),
      approximation: approximation("An approximate layer's other steps."),
      simplification: simplifySettings,
      lodSelection: {
        type: 'string',
        enum: HLOD_LOD_SELECTIONS,
        description: `A merge layer's LOD of each source, its merged mesh never simplified: the one it shows when its bounding sphere spans lodScreenSize of the view, or its fallback, the source simplified to an error of a hundredth of the source's size, the square root of the smaller of twice its level-0 area and a quarter of its box's surface (default ${HLOD_LOD_SELECTIONS[0]}).`,
      },
      lodScreenSize: num(
        "The share of the view a source's bounding sphere spans when the LOD a merge layer's calculate takes is drawn, above 0 (default 0.25).",
        undefined,
        1,
      ),
      collapseEquivalentMaterials: flag(
        'Whether a merge layer collapses equivalent materials, one definition under two names, into the first its sources name (default true).',
      ),
      mergeMaterials: flag(
        "Whether a merge layer merges its sources' materials into one atlas, one cell per material and what it bakes on (default false: each section wears its source's material).",
      ),
      bakeVertexColors: flag(
        "Whether a merge layer keeping its materials keeps its sources' vertex colours on its merged mesh, a source with none white (default false: a source's tint does not ride the merged mesh). Refused beside mergeMaterials, whose atlas already holds them.",
      ),
      textureSizing: {
        type: 'string',
        enum: ['fixed', 'texelDensity', 'screenSize', 'drawDistance', 'biased', 'manual'],
        description:
          "How an approximate layer, a merge layer merging its materials, or a simplify layer, sizes its atlas: fixed, textureSize; texelDensity, the power of two whose texels a metre over its mesh come nearest texelsPerMetre; screenSize, nearest those its bounding sphere spans filling atlasScreenSize of a 1920-texel view; drawDistance, where its actor is first drawn. Every layer also takes biased (the normal map at textureSize, the base colour at half, 32 at least for an approximate or simplify layer and 8 for a merge layer, which also puts its tangent map at half, its other maps at a quarter, 16 at least and 4) and manual (each map at its mapSizes side); an approximate layer's textureSize still sizes its views and packing, a merge or simplify layer's sizes only a fixed or biased atlas (default fixed).",
      },
      mapSizes,
      texelsPerMetre: num(
        'The texels a metre a texelDensity atlas aims for (default 5).',
        0.1,
        1024,
      ),
      atlasScreenSize: num(
        "The share of the view a screenSize atlas's mesh is sized for (default 0.5).",
        0.01,
        1,
      ),
      atlasGutter: int(
        "Each cell's gutter in a merge layer's atlas, or the texels between two charts of a simplify layer's (default 2 for merge, 4 for simplify).",
        0,
        64,
      ),
      binByTextureSize: flag(
        "Whether a merge layer's cells are squares sized by their materials' largest textures rather than a grid (default false).",
      ),
      bakeOnMesh: flag(
        'Whether a material whose look its mesh decides (texture coordinates leaving the unit square, a vertex colour, a baked map reading a second set) bakes on that mesh rather than on a full-frame quad (default true).',
      ),
      reuseLightmapUVs: flag(
        "Whether a merge layer's mesh baked on its own triangles is laid at the texture set its mesh has at its lightmap index — its first open set, as many as it has sets (1 when it holds eight) — where it has one, else at coordinates generated by uvMethod; a simplify layer's object does so where every one of its primitives has such a set, else at coordinates generated for the whole object (default true).",
      ),
      groupIdenticalMeshes: flag(
        "Whether a simplify layer bakes the objects that place one mesh once, from the first of them: its images and the coordinates generated for its triangles, which each other object's primitives read at their own triangles. Faster and sharper, but a material that reads its world position or per-instance data looks as the first object's (default false).",
      ),
      allowVertexColors: flag(
        "Whether a simplify layer's mesh carries its sources' vertex colours, each vertex the colour of the source triangle nearest it blended at its projection and set back to the triangle's mean luminance, white where no source answers; otherwise it carries none (default false). The atlas holds the sources' colours already, so a material that draws vertex colours shows them twice.",
      ),
      uvMethod: {
        type: 'string',
        enum: [...HLOD_MERGE_UV_METHODS],
        description: `How a merge layer generates the unique texture coordinates of a mesh baked on its own triangles that has none to reuse: ${HLOD_MERGE_UV_METHODS[0]}, the patch builder; ${HLOD_MERGE_UV_METHODS[2]}, patches grown by normal-weighed distance and merged into islands; ${HLOD_MERGE_UV_METHODS[1]}, charts grown by cost and flattened conformally. The reference's legacy and uvAtlas are refused: the compiler holds neither (default ${HLOD_MERGE_UV_METHODS[0]}).`,
      },
      allowDoubleSided: flag(
        "Whether a merge or simplify layer's flattened material may draw both faces when one of its materials does (default true).",
      ),
      maps: layerMaps,
      translucency: choiceOrFlag(
        `How an approximate layer's atlas, a merge layer's merging its materials, or a simplify layer's flattened sources, bake a translucent source (transmitting light or alpha-blended): ${HLOD_TRANSLUCENCIES[1]}, each baked channel the share its own lit layer covers of its value and the rest the value of what lies behind it, front to back to the first opaque surface, its normal the outermost's, so far glass keeps the tint it has up close; ${HLOD_TRANSLUCENCIES[0]}, its surface alone (an approximation sees what lies behind it, a merged atlas bakes its own colour). A translucent material seen through bakes on its mesh. true is ${DEFAULT_HLOD_TRANSLUCENCY}, false ${HLOD_TRANSLUCENCIES[0]} (default ${DEFAULT_HLOD_TRANSLUCENCY}).`,
        HLOD_TRANSLUCENCIES,
        'A translucency.',
        `true ${DEFAULT_HLOD_TRANSLUCENCY}, false ${HLOD_TRANSLUCENCIES[0]}.`,
      ),
      emptyTexels: choiceOrFlag(
        `What an approximate or simplify layer's atlas holds where it holds no chart's value (its empty texels, outside every chart, and its gutter's copies of texels no view sees): ${HLOD_EMPTY_TEXELS[1]}, the nearest chart's values on every map, the normal map's too, given before the holes are filled and the atlas averaged down, so no black reaches a chart's border nor a mip; ${HLOD_EMPTY_TEXELS[0]}, black (the frame's up on the normal map, zero on a baked roughness or metallic), which the holes beside a chart, the averaging down and the mips then read, so a chart's border darkens on far levels. true is ${DEFAULT_HLOD_EMPTY_TEXELS}, false ${HLOD_EMPTY_TEXELS[0]} (default ${DEFAULT_HLOD_EMPTY_TEXELS}).`,
        HLOD_EMPTY_TEXELS,
        'A value.',
        `true ${DEFAULT_HLOD_EMPTY_TEXELS}, false ${HLOD_EMPTY_TEXELS[0]}.`,
      ),
      clusterDag: flag(
        'Whether the mesh of each actor an approximate, merge or simplify layer builds gets a cluster DAG, its coarser levels drawn within the pixel error (default true); false, one level drawn whole at every distance. An instanced layer builds no mesh while it is true: each object keeps its own DAG. False draws each object it takes at the last LOD of its mesh, its fallback, built as a merge layer keeping its materials builds it: one mesh per cell and material, drawn whole.',
      ),
      meshBuild: hlodMeshBuild,
      sizeFilter: {
        type: 'string',
        enum: ['none', 'extent', 'area', 'volume'],
        description:
          'Which objects an instanced layer takes by the size of their world box: none; extent, its largest half extent at least minExtent metres; area, its surface at least minArea square metres; volume, its volume at least minVolume cubic metres. An object turned away enters no HLOD (default none).',
      },
      minExtent: num('The least half extent, metres, of an extent filter (default 0).', 0),
      minArea: num('The least surface, square metres, of an area filter (default 0).', 0),
      minVolume: num('The least volume, cubic metres, of a volume filter (default 0).', 0),
      spatiallyLoaded: flag(
        "Whether the actors it builds stream on its grid (default true); false, they are always loaded and nothing is built of them: the top of its chain, the parent it names let go, an instanced layer's objects (clusterDag left true) loaded with the scene.",
      ),
      cellSize: positive(
        `Under the spatialHash scheme alone (hashSet, the default, ignores it): the side, metres, of its grid's cells, one grid per HLOD level, cell side and loading range (default ${DEFAULT_HLOD_CELL_SIZE}); none for a layer not spatially loaded.`,
      ),
      loadingRange: positive(
        `Under the spatialHash scheme alone (hashSet ignores it): how near, metres, the view comes to a cell of its grid before that cell loads (default ${DEFAULT_HLOD_LOADING_RANGE}); none for a layer not spatially loaded.`,
      ),
    },
  },
}))()
