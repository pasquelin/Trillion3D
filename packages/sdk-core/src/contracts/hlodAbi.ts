/**
 * The HLOD the compiler and the runtime both state, printed into the compiler's Rust
 * (`scripts/build/shared-rules/abi.ts`): how a layer builds its actors, the values its settings
 * name, their defaults and bounds, the marks a glTF node carries, and the match a rule names its
 * objects by. The layer's own settings are `hlodApproximationAbi.ts`'s and `hlodLayerAbi.ts`'s;
 * `compilerAbi.ts` re-exports them all.
 */

/** How an HLOD layer builds its actors:
 *  - `instanced`: the objects themselves, each its source mesh at its own detail. A layer asking
 *    for no cluster DAG (`clusterDag: false`) is built the way a `merge` layer keeping its
 *    materials builds its actors, each source at the last LOD of its mesh;
 *  - `approximate`: one closed shell per cell, wearing a flattened material;
 *  - `merge`: the cell's objects merged into one mesh;
 *  - `voxel`: the cell's objects voxelized together, levels of bricks the cut picks by their
 *    error — no shell, no atlas, a leaf's cut-out kept;
 *  - `simplify`: the cell's objects remeshed through their volume — a signed distance field, its
 *    gaps closed, its surface drawn —, simplified for the distance the actor is first drawn from,
 *    charted and wearing their materials transferred onto one atlas.
 *
 *  Any layer may take objects, its actors then their HLOD 0, and any may build another's cells'
 *  actors, save a parent wearing its sources' own materials — `instanced`, or `merge` keeping its
 *  materials — above a layer whose actors wear materials of their own. */
export const HLOD_BUILDERS = ['instanced', 'approximate', 'merge', 'voxel', 'simplify'] as const
/** One of `HLOD_BUILDERS`. */
export type HlodBuilder = (typeof HLOD_BUILDERS)[number]
/** Which LOD of each source a `merge` layer takes: `calculate`, the one it shows when its bounding
 *  sphere spans the layer's `lodScreenSize` of the view; `lowest`, its fallback: the source
 *  simplified to an error of a hundredth of the source's size, the square root of the smaller of
 *  twice its level-0 area and a quarter of its box's surface, stopping at 256 triangles at the
 *  latest (a source of 256 or fewer stays as it is). */
export const HLOD_LOD_SELECTIONS = ['calculate', 'lowest'] as const
/** One of `HLOD_LOD_SELECTIONS`. */
export type HlodLodSelection = (typeof HLOD_LOD_SELECTIONS)[number]
/** How a `merge` layer's `uvMethod` generates the unique texture coordinates of a mesh baked on
 *  its own triangles that has none to reuse: `default`, the generator's own, the patch builder;
 *  `xAtlas`, charts grown by cost and flattened conformally; `patchBuilder`, patches grown by
 *  normal-weighed distance and merged into islands. The generator also offers `legacy` and
 *  `uvAtlas`, which the compiler refuses: it holds neither. */
export const HLOD_MERGE_UV_METHODS = ['default', 'xAtlas', 'patchBuilder'] as const
/** One of `HLOD_MERGE_UV_METHODS`. */
export type HlodMergeUvMethod = (typeof HLOD_MERGE_UV_METHODS)[number]
/** How an `approximate` layer's atlas, or a `merge` layer's merging its materials, bakes a
 *  translucent source — one that transmits light (`KHR_materials_transmission`) or one drawn
 *  alpha-blended —, the value `false` names first: `surfaceOnly`, its surface alone — the
 *  approximation's views never draw it, so what lies behind it shows, and a merged atlas bakes its
 *  own colour —; `seenThrough`, as it is seen through — each baked channel, base colour, roughness
 *  and metallic, the share of the texel its own lit layer covers (its opacity, times, where it
 *  transmits, the larger of the share it does not transmit, its metallic and its roughness) of its
 *  value and the rest of the value of what lies behind it, layer after layer to the first opaque
 *  surface, the last layer standing for what lies behind where nothing opaque does, the normal the
 *  outermost's —, so a far glass tower keeps the tint it has up close at every level. A layer's
 *  `translucency` names one, `true` the default (`DEFAULT_HLOD_TRANSLUCENCY`); a layer leaving it
 *  out keeps its cache key. */
export const HLOD_TRANSLUCENCIES = ['surfaceOnly', 'seenThrough'] as const
/** One of `HLOD_TRANSLUCENCIES`. */
export type HlodTranslucency = (typeof HLOD_TRANSLUCENCIES)[number]
/** The translucency `true`, or nothing, names: a translucent source baked as it is seen through. */
export const DEFAULT_HLOD_TRANSLUCENCY = 'seenThrough' satisfies HlodTranslucency
/** What an `approximate` layer's atlas holds where it holds no chart's value — its empty texels,
 *  outside every chart, and its gutter's copies of texels no view sees —, the value `false` names
 *  first: `black`, what the bake writes there — black, the frame's up on the normal map, zero on a
 *  baked roughness or metallic —, which the holes beside a chart are filled from and the
 *  supersampling's averaging down and the mips read, so a chart's border darkens on far levels;
 *  `nearestChart`, the nearest chart's values on every map, the normal map's too, given before the
 *  holes are filled and the atlas averaged down — ring by ring outward from the charts, each texel
 *  the mean of its neighbours holding one —, so no black reaches a chart's border nor a mip. A
 *  layer's `emptyTexels` names one, `true` the default (`DEFAULT_HLOD_EMPTY_TEXELS`); a layer
 *  leaving it out keeps its cache key. A `merge` layer's atlas has no such switch: it always fills
 *  its gutters and empty cells from the cells around them. */
export const HLOD_EMPTY_TEXELS = ['black', 'nearestChart'] as const
/** One of `HLOD_EMPTY_TEXELS`. */
export type HlodEmptyTexels = (typeof HLOD_EMPTY_TEXELS)[number]
/** The empty texels `true`, or nothing, names: the nearest chart's values. */
export const DEFAULT_HLOD_EMPTY_TEXELS = 'nearestChart' satisfies HlodEmptyTexels
/** How an `approximate` layer closes its scene's base before the solid is read
 *  (`approximation.baseCapping`), the value `false` names first: `none`; `convexPolygon`, the
 *  convex hull of the vertices within `baseHeight` above the scene's lowest point, a flat polygon
 *  there facing down, which makes the scene read as open meshes; `convexSolid`, that polygon
 *  extruded up by `baseThickness` into a slab. `true` names the default; a layer leaving it out
 *  keeps its cache key. */
export const HLOD_BASE_CAPPINGS = ['none', 'convexPolygon', 'convexSolid'] as const
/** One of `HLOD_BASE_CAPPINGS`. */
export type HlodBaseCapping = (typeof HLOD_BASE_CAPPINGS)[number]
/** The base capping `true`, or nothing, names: none. */
export const DEFAULT_HLOD_BASE_CAPPING = 'none' satisfies HlodBaseCapping
/** How a horizontal plane at `groundHeight` clips an `approximate` layer's shell once its hidden
 *  triangles are dropped (`approximation.groundClipping`), the value `false` names first: `none`;
 *  `discard`, the triangles whose corners all lie on or under it dropped with the hidden ones —
 *  only where the occlusion filter drops some —; `cut`, the shell cut along it and what lies under
 *  it removed; `cutAndFill`, cut and each cut loop filled flat. `true` names the default; a layer
 *  leaving it out keeps its cache key. */
export const HLOD_GROUND_CLIPPINGS = ['none', 'discard', 'cut', 'cutAndFill'] as const
/** One of `HLOD_GROUND_CLIPPINGS`. */
export type HlodGroundClipping = (typeof HLOD_GROUND_CLIPPINGS)[number]
/** The ground clipping `true`, or nothing, names: none. */
export const DEFAULT_HLOD_GROUND_CLIPPING = 'none' satisfies HlodGroundClipping
/** How a `simplify` layer's vertex normals weigh the faces around a vertex: `angleWeighted`, by
 *  the angle each makes there (the default); `areaWeighted`, by its area; `equalWeighted`, alike. */
export const HLOD_NORMAL_METHODS = ['angleWeighted', 'areaWeighted', 'equalWeighted'] as const
/** How a `simplify` layer's transfer rays — one each way along a texel's normal — pick their hit:
 *  `nearest`, the nearer (the default); `facing`, a source facing the ray's way first. */
export const HLOD_TRANSFER_RAYS = ['nearest', 'facing'] as const
/** The atlas sides, in texels, a layer may name: a power of two in these bounds. */
export const MIN_HLOD_TEXTURE_SIZE = 16
/** See `MIN_HLOD_TEXTURE_SIZE`. */
export const MAX_HLOD_TEXTURE_SIZE = 8192
/** A layer's atlas side when it names none. */
export const DEFAULT_HLOD_TEXTURE_SIZE = 1024
/** An `approximate` layer's voxel, metres, when it names none, whatever the distance its actors
 *  are first seen from: its solid's grid holds the cell's diagonal over it, 64 to 1024 voxels. */
export const DEFAULT_HLOD_ACCURACY = 1
/** An `approximate` layer's geometric deviation, metres, when it names none: what its shell may
 *  stray from the closed solid once simplified. */
export const DEFAULT_HLOD_DEVIATION = 0.1
/** A layer's grid, when it names none: the actors it builds stream on cells of this side, metres,
 *  each loaded while the view lies within `DEFAULT_HLOD_LOADING_RANGE` of it. */
export const DEFAULT_HLOD_CELL_SIZE = 256
/** See `DEFAULT_HLOD_CELL_SIZE`. */
export const DEFAULT_HLOD_LOADING_RANGE = 512
/** The fewest levels the simple form's main chain may have, HLOD 0 included: its first merged
 *  layer takes the props' cells. */
export const MIN_HLOD_LEVELS = 2
/** The most levels a chain may have, HLOD 0 included: the world table writes a level in 8 bits. */
export const MAX_HLOD_LEVELS = 256
/** The default chain's levels: the objects themselves, then one merged level. */
export const DEFAULT_HLOD_LEVELS = 2
/** A 1×1 opaque white PNG: what a scene decodes in place of an image whose mip chain the cache
 *  bakes — the image an HLOD actor's flattened material names, and what the prepared scene
 *  decodes for an image it skips reading. */
export const BAKED_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII='

/** A pattern as the compiler reads it: a string the exact name, `{ regex, flags }` a regular
 *  expression (flags `i`, `m`, `s`). */
export type HlodWirePattern = string | { regex: string; flags?: string }

/** What a rule matches on what the glTF already carries, each name a pattern `P`: a node's name,
 *  its mesh's name, one of its primitives' material names, and values its `extras` holds — a
 *  pattern for a string, else the exact value. Every field named must match; a rule naming none
 *  is refused. */
export interface HlodMatchOf<P> {
  /** The node's name. */ node?: P
  /** Its mesh's name. */ mesh?: P
  /** One of its primitives' material names. */ material?: P
  /** Values its `extras` must hold. */
  extras?: Record<string, P | number | boolean | null>
}

/** A rule's match as the compiler reads it. */
export type HlodWireMatch = HlodMatchOf<HlodWirePattern>

/** The key of a glTF node's `extras` that marks its object for an HLOD: a group of the simple
 *  form or a layer of the expert form, by name — `"extras": { "hlod": "buildings" }`. A mark wins
 *  over the rules by name; a mark naming no group nor layer refuses the job. */
export const HLOD_MARK = 'hlod'
/** The key of a glTF node's `extras` whose `true` makes its object stand as itself in every actor
 *  its chain builds: its meshes instanced there, each at its own detail, beside what the actor's
 *  builder makes of the other objects — `"extras": { "hlodInstance": true }`. Off when absent. */
export const HLOD_INSTANCE_MARK = 'hlodInstance'
/** The key of a glTF node's `extras` whose `false` takes its object out of every HLOD layer,
 *  whatever a mark, a rule or the default would give it — `"extras": { "hlodInclude": false }`:
 *  it streams in its cell and draws while that cell is loaded, nothing standing for it beyond.
 *  On when absent. */
export const HLOD_INCLUDE_MARK = 'hlodInclude'

/** The job field naming the HLOD (`HlodWire`): a batch job's field, the command line's `--hlod=`
 *  flag (`HLOD_OPTION`) holding it as JSON — never a positional field. */
export const HLOD_FIELD = 'hlod'
/** The command line's flag naming the HLOD, its JSON after the `=`. */
export const HLOD_OPTION = '--hlod='
