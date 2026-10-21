/**
 * One HLOD layer as a host writes it, and the expert form that names the layers and the rules
 * assigning objects to them (`hlodAbi.ts` holds the values a layer's settings name,
 * `hlodApproximationAbi.ts` the settings of an `approximate` and of a `simplify` layer,
 * `meshBuildAbi.ts` a layer's `meshBuild`).
 */
import type {
  HlodBuilder,
  HlodEmptyTexels,
  HlodLodSelection,
  HlodMatchOf,
  HlodMergeUvMethod,
  HlodTranslucency,
  HlodWirePattern,
} from './hlodAbi.ts'
import type { HlodApproximation, HlodSimplifySettings } from './hlodApproximationAbi.ts'
import type { HlodMeshBuildWire } from './meshBuildAbi.ts'

/** One HLOD layer: its name, its builder, the layer its cells' actors are built by (`parent`;
 *  none at the top of a chain), and its builder's settings, each its default when left out. A
 *  builder refuses another's settings; a `merge` layer's atlas settings need `mergeMaterials`,
 *  and a sizing's setting its sizing. */
export interface HlodLayer {
  /** Its name, unique among the layers. */ name: string
  /** How it builds its actors. */ builder: HlodBuilder
  /** The layer its cells' actors are built by; none at the top of a chain. */ parent?: string
  /** An `approximate` layer's voxel, metres. @defaultValue `DEFAULT_HLOD_ACCURACY` */
  accuracy?: number
  /** An `approximate` layer's geometric deviation, metres: what its shell is simplified within.
   *  @defaultValue `DEFAULT_HLOD_DEVIATION` */
  deviation?: number
  /** The atlas side of an `approximate` layer, or of a `merge` layer merging its materials or a
   *  `simplify` layer sized `fixed` or `biased`, texels, a power of two.
   *  @defaultValue `DEFAULT_HLOD_TEXTURE_SIZE` */
  textureSize?: number
  /** An `approximate` layer's other settings, each defaulted. */
  approximation?: HlodApproximation
  /** A `simplify` layer's own settings, each defaulted. */
  simplification?: HlodSimplifySettings
  /** A `merge` layer's LOD of each source (`HLOD_LOD_SELECTIONS`), its merged mesh never
   *  simplified; `lowest` takes each source's fallback: the source simplified to an error of a
   *  hundredth of the source's size, the square root of the smaller of twice its level-0 area and
   *  a quarter of its box's surface, stopping at 256 triangles at the latest.
   *  @defaultValue 'calculate' */
  lodSelection?: HlodLodSelection
  /** The share of the view, above 0 and 1 at most, a source's bounding sphere spans when the LOD
   *  a `merge` layer's `calculate` takes is drawn. @defaultValue 0.25 */
  lodScreenSize?: number
  /** Whether a `merge` layer collapses equivalent materials — one definition under two names —
   *  into the first its sources name. @defaultValue true */
  collapseEquivalentMaterials?: boolean
  /** Whether a `merge` layer merges its sources' materials into one atlas, one cell per material
   *  and what it bakes on; otherwise each section wears its source's material. @defaultValue false */
  mergeMaterials?: boolean
  /** Whether a `merge` layer keeping its materials (no `mergeMaterials`) keeps its sources' vertex
   *  colours on its merged mesh, a source with none white; otherwise a source's tint does not ride
   *  the merged mesh. Refused beside `mergeMaterials`: the atlas of a layer merging its materials
   *  already holds its sources' vertex colours. @defaultValue false */
  bakeVertexColors?: boolean
  /** How an `approximate` layer, a `merge` layer merging its materials, or a `simplify` layer,
   *  sizes its atlas: `fixed`, `textureSize`; `texelDensity`, the power of two whose texels a metre
   *  over its mesh come nearest `texelsPerMetre`; `screenSize`, nearest those its bounding sphere
   *  spans filling `atlasScreenSize` of a 1920-texel view; `drawDistance`, where its actor is first
   *  drawn. Every layer also takes `biased` — the normal map at `textureSize`, the base colour at
   *  half, 32 at least for an `approximate` or `simplify` layer and 8 for a `merge` layer, which
   *  also puts its tangent map at half, its other maps at a quarter, 16 at least and 4 — and
   *  `manual`, each map at its `mapSizes` side; an `approximate` layer's `textureSize` still
   *  sizes its views and packing whatever the sizing, a `merge` or `simplify` layer's sizes only
   *  a `fixed` or `biased` atlas. @defaultValue 'fixed' */
  textureSizing?: 'fixed' | 'texelDensity' | 'screenSize' | 'drawDistance' | 'biased' | 'manual'
  /** The texels a metre a `texelDensity` atlas aims for, 0.1 to 1024. @defaultValue 5 */
  texelsPerMetre?: number
  /** The share of the view a `screenSize` atlas's mesh is sized for, 0.01 to 1. @defaultValue 0.5 */
  atlasScreenSize?: number
  /** Each map's side in a `manual` atlas, texels, 16 to 8192, rounded up to a power of two; the
   *  atlas is baked at the largest and each map averaged down to its own. An `approximate` layer
   *  names `base`, `normal`, `roughness`, `metallic`, `specular` and `emissive`; a `merge` layer
   *  names all eleven; a `simplify` layer names the eight its transfer writes — `base`, `normal`,
   *  `roughness`, `metallic`, `specular`, `emissive`, `opacity` and `opacityMask`; the packed
   *  images take the largest side of the maps they pack that the layer bakes — the base colour
   *  with `opacity` or `opacityMask`, the metal-roughness map with its three, the anisotropy map
   *  with `tangent`. @defaultValue 1024 each */
  mapSizes?: {
    base?: number
    normal?: number
    tangent?: number
    roughness?: number
    metallic?: number
    anisotropy?: number
    specular?: number
    emissive?: number
    opacity?: number
    opacityMask?: number
    ambientOcclusion?: number
  }
  /** Each cell's gutter in a `merge` layer's atlas, or the texels between two charts of a
   *  `simplify` layer's, up to 64. @defaultValue 2 for `merge`, 4 for `simplify` */
  atlasGutter?: number
  /** Whether a `merge` layer's cells are squares sized by their materials' largest textures rather
   *  than a grid. @defaultValue false */
  binByTextureSize?: boolean
  /** Whether a material whose look its mesh decides — texture coordinates leaving the unit square,
   *  a vertex colour, a baked map reading a second set — bakes on that mesh's own triangles
   *  rather than on a full-frame quad. @defaultValue true */
  bakeOnMesh?: boolean
  /** Whether a `merge` layer's mesh baked on its own triangles is laid at the texture set its
   *  mesh has at its lightmap index — its first open set, as many as it has sets (1 when it holds
   *  eight) — where it has one, else at coordinates generated by `uvMethod`; a `simplify` layer's
   *  object does so where every one of its primitives has such a set, else at coordinates
   *  generated for the whole object. @defaultValue true */
  reuseLightmapUVs?: boolean
  /** Whether a `simplify` layer bakes the objects that place one mesh once, from the first of
   *  them: its images and the coordinates generated for its triangles, which each other object's
   *  primitives read at their own triangles. Faster and sharper, but a material that reads its
   *  world position or per-instance data looks as the first object's. @defaultValue false */
  groupIdenticalMeshes?: boolean
  /** Whether a `simplify` layer's mesh carries its sources' vertex colours — each vertex the
   *  colour of the source triangle nearest it, blended at its projection and set back to the
   *  triangle's mean luminance —, white where no source answers; otherwise it carries none. The
   *  atlas holds the sources' colours already, so a material that draws vertex colours shows them
   *  twice. @defaultValue false */
  allowVertexColors?: boolean
  /** How a `merge` layer generates the unique texture coordinates of a mesh baked on its own
   *  triangles that has no texture set to reuse: `default`, the patch builder; `patchBuilder`,
   *  patches grown by normal-weighed distance and merged into islands; `xAtlas`, charts grown by
   *  cost and flattened conformally (`HLOD_MERGE_UV_METHODS`). The reference's `legacy` and
   *  `uvAtlas` are refused: the compiler holds neither. @defaultValue 'default' */
  uvMethod?: HlodMergeUvMethod
  /** Whether a `merge` or `simplify` layer's flattened material may draw both faces when one of
   *  its materials does. @defaultValue true */
  allowDoubleSided?: boolean
  /** The images a `merge` or `simplify` layer's atlas bakes beside the base colour; a channel not
   *  baked takes the constant roughness 0.5 or metallic 0. A `simplify` layer names the first
   *  seven, a proxy's transfer having no step for the others; a `merge` layer all: `specular`
   *  rides the metal-roughness map's red channel;
   *  `emissive` is a map of its own over its strength; `opacity` or `opacityMask` — at most one,
   *  a glTF material having one alpha — is the base image's alpha, the material drawn blended or
   *  masked; `ambientOcclusion` is glTF's occlusion map; `anisotropy` and `tangent` are one image,
   *  `KHR_materials_anisotropy`'s texture — the direction in red and green, the strength in blue
   *  —, which the runtime does not draw yet.
   *  @defaultValue { normal: true, and every other map false } */
  maps?: {
    normal?: boolean
    roughness?: boolean
    metallic?: boolean
    specular?: boolean
    emissive?: boolean
    opacity?: boolean
    opacityMask?: boolean
    ambientOcclusion?: boolean
    anisotropy?: boolean
    tangent?: boolean
  }
  /** How an `approximate` layer's atlas, or a `merge` layer's merging its materials, or a
   *  `simplify` layer's sources' flattened materials, bake a translucent source
   *  (`HLOD_TRANSLUCENCIES`): `seenThrough` over what lies behind it, or `surfaceOnly`; `true` the
   *  default, `false` `surfaceOnly`. A translucent material seen through bakes on its mesh,
   *  whatever `bakeOnMesh` says.
   *  @defaultValue `DEFAULT_HLOD_TRANSLUCENCY` */
  translucency?: HlodTranslucency | boolean
  /** What an `approximate` or `simplify` layer's atlas holds where it holds no chart's value
   *  (`HLOD_EMPTY_TEXELS`): `nearestChart`, the nearest chart's values on every map, or `black`;
   *  `true` the default, `false` `black`. @defaultValue `DEFAULT_HLOD_EMPTY_TEXELS` */
  emptyTexels?: HlodEmptyTexels | boolean
  /** Whether the mesh of each actor an `approximate`, `merge` or `simplify` layer builds gets a
   *  cluster DAG, its coarser levels drawn within the pixel error; `false`, one level drawn whole
   *  at every distance. An `instanced` layer builds no mesh while it is `true`: each object it
   *  takes keeps its own DAG, its source mesh placed. `false` is the same switch for it — the
   *  objects no longer drawn through their cluster DAG —: each is drawn at the last LOD of its
   *  mesh, its fallback (`lodSelection: 'lowest'`: the source simplified to an error of a
   *  hundredth of the source's size, the square root of the smaller of twice its level-0 area and
   *  a quarter of its box's surface, stopping at 256 triangles at the latest), as the
   *  reference draws an instanced mesh whose cluster DAG is disallowed. The layer then builds
   *  those fallbacks as a `merge` layer keeping its materials does — one mesh per cell and
   *  material, drawn whole, wearing the source's material, never a copy of an object's own DAG —
   *  and every `merge` rule applies to it (`parent`, `spatiallyLoaded`, the grid of its cells);
   *  an object marked `hlodInstance` still stands as itself. @defaultValue true */
  clusterDag?: boolean
  /** How a `merge` or `simplify` layer builds the mesh of each actor it makes
   *  (`HLOD_MESH_BUILD_SETTINGS`), as the reference reads it from those layers alone: what
   *  its finest level keeps (`keptTriangles`, `trimmedError`), whether its near-collapsed
   *  triangles are dropped (`dropNearCollapsed`), how much of it stays resident while its actor is
   *  loaded (`alwaysResidentKib`, its cell's root pages), and how it keeps its shape
   *  (`shapePreservation`, `edgeLengthBound`, `holdTextureCoordinates`).
   *  @defaultValue each setting the reference's default */
  meshBuild?: HlodMeshBuildWire
  /** Which objects an `instanced` layer takes by the size of their world box: `none`; `extent`,
   *  its largest half extent at least `minExtent` metres; `area`, its surface at least `minArea`
   *  square metres; `volume`, its volume at least `minVolume` cubic metres. An object turned away
   *  enters no HLOD. @defaultValue 'none' */
  sizeFilter?: 'none' | 'extent' | 'area' | 'volume'
  /** The least half extent, metres, of an `extent` filter. @defaultValue 0 */
  minExtent?: number
  /** The least surface, square metres, of an `area` filter. @defaultValue 0 */
  minArea?: number
  /** The least volume, cubic metres, of a `volume` filter. @defaultValue 0 */
  minVolume?: number
  /** Whether the actors it builds stream on a grid of their own; `false`, they are always loaded
   *  and nothing is built of them — the top of its chain, the parent it names let go —: an
   *  instanced layer's objects (`clusterDag` left `true`) then stay loaded with the scene.
   *  @defaultValue true */
  spatiallyLoaded?: boolean
  /** Under the `spatialHash` scheme alone (`hashSet`, the default, ignores it: HLOD level `i`
   *  streams on `2 << i` times the main grid's cell): the side, metres, of the cells of its grid —
   *  one per HLOD level, cell side and loading range —; a layer not spatially loaded names none.
   *  @defaultValue `DEFAULT_HLOD_CELL_SIZE` */
  cellSize?: number
  /** Under the `spatialHash` scheme alone (`hashSet` ignores it): how near, metres, the view comes
   *  to a cell of its grid before that cell loads; a layer not spatially loaded names none.
   *  @defaultValue `DEFAULT_HLOD_LOADING_RANGE` */
  loadingRange?: number
}

/** Named layers and the rules assigning objects to them, each name a pattern `P`: an object's
 *  mark first (`HLOD_MARK`), then the first rule that matches, then `default`. An object none
 *  names has no layer: it enters no HLOD actor, streamed and drawn in its cell, nothing standing for it
 *  beyond. Each object follows its layer's chain of parents; two chains build distinct actors in
 *  one cell, one per layer and cell. */
export interface HlodExpertOf<P> {
  /** The layers; each `parent` names the layer its cells' actors are built by. */
  layers: HlodLayer[]
  /** The rules, in order. @defaultValue [] */
  assign?: { match: HlodMatchOf<P>; layer: string }[]
  /** The layer of an object no rule matches. @defaultValue none: such an object has no HLOD */
  default?: string
}

/** The HLOD as the compiler reads it (`resolveHlod` writes it): the expert form, and the layer each
 *  mark names (`marks`) where a mark is not a layer's name — the simple form's groups. A job
 *  naming none builds none. */
export type HlodWire = HlodExpertOf<HlodWirePattern> & { marks?: Record<string, string> }
