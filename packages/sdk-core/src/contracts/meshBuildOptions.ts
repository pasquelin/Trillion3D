/**
 * A compile job's mesh build settings as a host names them, and the functions that turn them into
 * the form the compiler reads (`compiler/args/mesh_build.rs`, `MeshBuildOptions::read`).
 *
 * `meshBuild` sets, for every mesh of the scene, the settings of `MESH_BUILD_SETTINGS`:
 * - `storedTangents`: the pages store the build's tangents — the source's own unless the build
 *   rebuilds them —, which the shading takes in place of the frame it rebuilds from the triangle —
 *   `false` by default;
 * - `keptTriangles`: the share of the source's triangles the finest level may hold, in [0, 1] —
 *   1 by default, every triangle;
 * - `trimmedError`: the error, in percent of the mesh's size, its finest level must reach, at
 *   least 0 — 0 by default, none;
 * - `dropNearCollapsed`: a triangle two of whose corners lie within 200 nanometres of each other
 *   is dropped before the build (`true`), or only one two of whose corners are one point
 *   (`false`, the default);
 * - `alwaysResidentKib`: how much of the mesh stays resident whatever the view, in KiB, a whole
 *   number from 0 to `MAX_ALWAYS_RESIDENT_KIB`: its root pages, 32 KiB each, hold at least that
 *   much of its coarsest clusters — 0 by default, one root page;
 * - `recomputeNormals`: the build rebuilds every normal from the triangles, two triangles sharing
 *   an edge smoothed together, and every stored tangent with them (`true`, the default), or keeps
 *   the source's, rebuilding only a normal that is nothing (`false`); a skinned mesh keeps its
 *   source's frames either way;
 * - `recomputeTangents`: the build rebuilds every stored tangent (`true`, the default), or keeps
 *   the source's when it keeps its normals (`false`);
 * - `useMikkTSpace`: the rebuilt tangents are MikkTSpace's (`true`, the default), or the sum of
 *   each vertex's triangles' (`false`);
 * - `computeWeightedNormals`: the rebuilt normals weigh each triangle by its area times its angle
 *   at the vertex (`true`), or alike (`false`, the default);
 * - `skinnedWeldPosition`, `skinnedWeldNormal`, `skinnedWeldTexture`: how far a skinned mesh's
 *   corners may differ — in metres on every axis, on every axis of their unit vectors, on each
 *   texture coordinate — and be welded into one vertex, numbers of at least 0 — 2e-7, 2e-5 and a
 *   1024th by default;
 * - `voxelRays`: how many rays are cast across each voxel of a voxelized mesh to sample its surface,
 *   a whole number of at least 0 — 64 by default; at most `MAX_VOXEL_RAYS` are cast, a count past 1
 *   rounded up to a multiple of `VOXEL_RAY_PACKET`, and 0 or 1 casts one;
 * - `voxelLevel`: the level of the mesh's DAG from which every group is voxels, a whole number —
 *   0 by default, a group voxels only where they are finer than its triangles;
 * - `voxelBackUp`: how far back, in voxel sides, each ray starts before its voxel, a ray whose
 *   nearest hit lies in that stretch left out of the count — 0 by default, not read with
 *   `voxelSeparable`;
 * - `voxelSeparable`: the rays of a voxel run along its axes alone, a hit counting within the
 *   voxel's depth (`true`), or in every direction (`false`, the default);
 * - `voxelNdf`: a voxel's normal is the axis of the distribution fitted to the normals its rays hit
 *   and its record keeps the fit's ratio (`true`, the default), or it is the direction of their
 *   mean alone (`false`);
 * - `voxelOpacity`: a voxel's record carries its coverage as its opacity and no coverage is handed
 *   over to its neighbours (`true`), or the coverage is handed over (`false`, the default) — the
 *   engine draws no voxel by its opacity, as the reference gives it a material alone;
 *   the six `voxel…` settings are read only for a mesh drawn as voxels far away — one a `voxelize`
 *   match or its own glTF `extras` names — and, from an HLOD `voxel` layer's own `meshBuild`, for
 *   the voxels of its cells (`voxelLevel` changes nothing there: every level of a cell is voxels);
 * - `allowAssemblies`: the assembly a mesh's glTF `extras.assembly` names — `parts`, meshes by
 *   their rank, each with an optional `materialRemap` (a glTF material for each of its primitives),
 *   and `nodes`, each a `part` and a glTF node's `matrix` or `translation`, `rotation` and `scale` —
 *   is built: each node of the assembly is a node of the scene under every node that places the
 *   mesh, carrying its part's mesh, whose pages are written once (`true`), or the mesh is its own
 *   triangles alone and the import report counts it (`false`, the default);
 * - `maxMeshCards`, `meshCardMinDensity`, `meshCardNormalThreshold`: the cards the compiler finds
 *   for the mesh (`meshCardsAbi.ts`) — boxes, each looking at the mesh along one of the six axis
 *   directions, that cover its surface —: the most it keeps, a whole number from 0 to
 *   `MAX_MESH_CARDS` (12, and 0 builds none), how much of its box's face a card's surfaces must
 *   fill to be kept, a number from 0 to 1 (0.2), and how squarely a surface must face a card's
 *   direction to be covered by it, the cosine of the angle between them, a number from 0 to 1
 *   (0.25);
 * - `displacementMaps`, `displacementUvChannel`, `displacementEdgeSplit`: the height maps baked
 *   into the mesh's triangles before its clusters are built — `[]`, none, by default —, the set
 *   of texture coordinates they are read at (0) and how the tessellation shares the vertices it
 *   adds (`seams`), for a mesh of one triangle primitive that names a `trimmedError` too
 *   (`displacementBakeAbi.ts`);
 * - `positionPrecision`: the position grid of the mesh's pages, cells of `2^-n` centimetre, a whole
 *   number from `MIN_POSITION_PRECISION` to `MAX_POSITION_PRECISION` — left out, it follows the
 *   density of the mesh (`POSITION_PRECISION_SETTING`);
 * - `normalPrecision`: the bits an axis of the octahedral normals, a whole number from 1 to
 *   `MAX_NORMAL_PRECISION` — 8 by default;
 * - `tangentPrecision`: the bits of the angle of the stored tangents, a whole number from 0 to
 *   `MAX_TANGENT_PRECISION` — 7 by default.
 * Its `objects` are rules `{ match, …settings }`, `match` naming objects as `voxelize` does: each
 * sets its settings for the meshes of the objects it matches. For each setting of a mesh, the
 * first that names it wins: the first rule matching one of its objects, the scene's setting, the
 * mesh's own glTF `extras` under the setting's name, the default. A job naming none compiles as
 * before, its cache key kept. A value left out or `null` names nothing, as the compiler reads it.
 */
import {
  DISPLACEMENT_MAPS_SETTING,
  displacementMapsRefusal,
  type DisplacementMapWire,
  type DisplacementEdgeSplit,
} from './displacementBakeAbi.ts'
import {
  MESH_BUILD_FIELD,
  MESH_BUILD_OBJECTS,
  MESH_BUILD_OPTION,
  MESH_BUILD_RULES,
  MESH_BUILD_SETTINGS,
  NORMAL_PRECISION_SETTING,
  POSITION_PRECISION_SETTING,
  TANGENT_PRECISION_SETTING,
  type MeshBuildSettingsWire,
  type MeshBuildWire,
} from './meshBuildAbi.ts'
import {
  MAX_NORMAL_PRECISION,
  MAX_POSITION_PRECISION,
  MAX_TANGENT_PRECISION,
  MIN_POSITION_PRECISION,
} from '../page/format.ts'
import {
  jsonJobOption,
  resolveByObject,
  type NameMatch,
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'
import { integerSetting, namedSetting, type SettingRule } from './settingRules.ts'

/** One source's mesh build settings, each the next source's, or its default, when left out. */
export type MeshBuildSettings = {
  /** Whether the pages store the build's tangents. @defaultValue false */
  storedTangents?: boolean
  /** The share of the source's triangles the finest level may hold, in [0, 1]. @defaultValue 1 */
  keptTriangles?: number
  /** The error the finest level must reach, percent of the mesh's size, at least 0.
   *  @defaultValue 0 */
  trimmedError?: number
  /** Whether a triangle two of whose corners lie within 200 nanometres of each other is dropped.
   *  @defaultValue false */
  dropNearCollapsed?: boolean
  /** How much of the mesh stays resident whatever the view, in KiB: its root pages hold at least
   *  that much, 0 one root page. @defaultValue 0 */
  alwaysResidentKib?: number
  /** Whether the build rebuilds every normal, and every stored tangent with them. A skinned mesh
   *  keeps its source's frames. @defaultValue true */
  recomputeNormals?: boolean
  /** Whether the build rebuilds every stored tangent. @defaultValue true */
  recomputeTangents?: boolean
  /** Whether the rebuilt tangents are MikkTSpace's. @defaultValue true */
  useMikkTSpace?: boolean
  /** Whether the rebuilt normals weigh each triangle by its area times its angle at the vertex.
   *  @defaultValue false */
  computeWeightedNormals?: boolean
  /** How far, in metres on every axis, a skinned mesh's corners may lie apart and be welded.
   *  @defaultValue 2e-7 */
  skinnedWeldPosition?: number
  /** How far, on every axis, a skinned mesh's unit normals, tangents and bitangents may differ
   *  and be welded. @defaultValue 2e-5 */
  skinnedWeldNormal?: number
  /** How far a skinned mesh's texture coordinates may differ and be welded.
   *  @defaultValue 1/1024 */
  skinnedWeldTexture?: number
  /** How many rays are cast across each voxel of a voxelized mesh, a whole number of at least 0:
   *  at most `MAX_VOXEL_RAYS`, a count past 1 rounded up to a multiple of `VOXEL_RAY_PACKET`, 0 or
   *  1 one ray. @defaultValue 64 */
  voxelRays?: number
  /** The level of the DAG from which every group of a voxelized mesh is voxels, a whole number:
   *  0, a group is voxels only where they are finer than its triangles. @defaultValue 0 */
  voxelLevel?: number
  /** How far back, in voxel sides, each ray of a voxel starts before it: a ray whose nearest hit
   *  lies in that stretch is left out of the count. Not read with `voxelSeparable`.
   *  @defaultValue 0 */
  voxelBackUp?: number
  /** Whether the rays of a voxel run along its axes alone, a hit counting within the voxel's
   *  depth. @defaultValue false */
  voxelSeparable?: boolean
  /** Whether a voxel's normal is the axis of the distribution fitted to the normals its rays hit,
   *  its record keeping the fit's ratio, or the direction of their mean alone. @defaultValue true */
  voxelNdf?: boolean
  /** Whether a voxel's record carries its coverage as its opacity, no coverage handed over to its
   *  neighbours; no voxel is drawn by it. @defaultValue false */
  voxelOpacity?: boolean
  /** Whether the assembly the mesh's glTF `extras.assembly` names is built, each of its nodes a node
   *  of the scene under every node that places the mesh, carrying its part's mesh; false draws the
   *  mesh's own triangles alone. @defaultValue false */
  allowAssemblies?: boolean
  /** Whether the mesh's signed distance field is built, for the distance-field occlusion and the
   *  software ray tracing. @defaultValue true */
  distanceField?: boolean
  /** The mesh's distance field resolution scale, at least 0 (0 builds none): the voxels a unit of
   *  its size holds are the density times it. @defaultValue 1 */
  distanceFieldScale?: number
  /** Whether the field is built as if every triangle were two-sided. @defaultValue false */
  distanceFieldTwoSided?: boolean
  /** The voxels a centimetre of a mesh of scale 1 holds, any finite number (the bricks are held
   *  between 1 and what the maximum resolution allows). @defaultValue 0.2 */
  distanceFieldDensity?: number
  /** The most voxels along one axis a field holds, at least 1; a mesh of scale 1 or less holds
   *  half. @defaultValue 256 */
  distanceFieldMaxResolution?: number
  /** The most cards the compiler keeps for the mesh, a whole number from 0 to `MAX_MESH_CARDS`: a
   *  card is a box looking at the mesh along one of the six axis directions, and more cards cover
   *  the surface better. 0 builds none. @defaultValue 12 */
  maxMeshCards?: number
  /** How much of its box's face the surfaces a card covers must fill for the card to be kept, a
   *  number from 0 to 1. @defaultValue 0.2 */
  meshCardMinDensity?: number
  /** How squarely a surface must face a card's direction to be covered by it, the cosine of the
   *  angle between them, a number from 0 to 1. @defaultValue 0.25 */
  meshCardNormalThreshold?: number
  /** The height maps baked into the mesh's triangles — `{ texture: { index }, magnitude, center }`,
   *  the first the one read — when the mesh has one triangle primitive and a `trimmedError`.
   *  @defaultValue [] */
  displacementMaps?: readonly DisplacementMapWire[]
  /** The set of texture coordinates the maps are read at, a whole number from 0 to 7.
   *  @defaultValue 0 */
  displacementUvChannel?: number
  /** How the tessellation shares the vertex it adds on an edge: one for both sides unless a
   *  material or a texture coordinate differs across it (`seams`), or one a side
   *  (`always-duplicate`). @defaultValue 'seams' */
  displacementEdgeSplit?: DisplacementEdgeSplit
  /** The position grid of the pages, cells of `2^-n` centimetre, a whole number from
   *  `MIN_POSITION_PRECISION` to `MAX_POSITION_PRECISION`. @defaultValue the mesh's density */
  positionPrecision?: number
  /** The bits an axis of the octahedral normals, a whole number from 1 to
   *  `MAX_NORMAL_PRECISION`. @defaultValue 8 */
  normalPrecision?: number
  /** The bits of the angle of the stored tangents, a whole number from 0 to
   *  `MAX_TANGENT_PRECISION`. @defaultValue 7 */
  tangentPrecision?: number
}

/** A rule of `objects`: the objects it names — a node's name (exact), a regular expression on it,
 *  or a match on what the glTF carries (`NameMatch`) — and the settings it sets for their meshes. */
export type MeshBuildRule = MeshBuildSettings & { match: NamePattern | NameMatch }

/** The mesh build settings: the scene's, and the rules setting them by object, the first wins. */
export type MeshBuildOption = MeshBuildSettings & { objects?: readonly MeshBuildRule[] }

/** A whole number of `field` from `low` to `high`: a rule read for what it takes alone, its
 *  default — left out, the position precision follows the mesh's density, the others take the page
 *  format's — being the resolver's none. */
const precision = (field: string, low: number, high: number): SettingRule =>
  integerSetting(field, low, [low, high])

/** What each setting takes: `MESH_BUILD_RULES`, then the page format's bounds of the precisions. */
const TAKES: Record<
  Exclude<(typeof MESH_BUILD_SETTINGS)[number], typeof DISPLACEMENT_MAPS_SETTING>,
  SettingRule
> = {
  ...MESH_BUILD_RULES,
  [POSITION_PRECISION_SETTING]: precision(
    POSITION_PRECISION_SETTING,
    MIN_POSITION_PRECISION,
    MAX_POSITION_PRECISION,
  ),
  [NORMAL_PRECISION_SETTING]: precision(NORMAL_PRECISION_SETTING, 1, MAX_NORMAL_PRECISION),
  [TANGENT_PRECISION_SETTING]: precision(TANGENT_PRECISION_SETTING, 0, MAX_TANGENT_PRECISION),
}

/** The settings of `named` the compiler reads, `what` naming them in a refusal. */
function settingsOf(named: Record<string, unknown>, what: string, refuse: Refuse) {
  const wire: Record<string, unknown> = {}
  for (const name of MESH_BUILD_SETTINGS) {
    const value = named[name]
    if (value === undefined || value === null) continue
    if (name === DISPLACEMENT_MAPS_SETTING) {
      const refusal = displacementMapsRefusal(value)
      if (refusal !== undefined) refuse(`${what}${refusal}`)
    } else namedSetting(TAKES[name], value, `${what}${name}`, refuse)
    wire[name] = value
  }
  return wire as MeshBuildSettingsWire
}

/**
 * The mesh build settings the compiler reads for `option`: none when left out.
 * @param option - The scene's settings and the rules by object, or none.
 * @returns The compiler's form (`MeshBuildWire`), `undefined` for none.
 * @throws TypeError naming the setting and what it takes, or the rule, when one is wrong.
 */
export function resolveMeshBuild(option?: MeshBuildOption | null): MeshBuildWire | undefined {
  if (option === undefined || option === null) return undefined
  return resolveByObject(
    option,
    MESH_BUILD_FIELD,
    MESH_BUILD_SETTINGS,
    MESH_BUILD_OBJECTS,
    settingsOf,
  )
}

/** A job's `meshBuild` as the job field and the command line's flag the compiler reads
 *  (`jsonJobOption`): `fields` left out, `flags` none, when the job names none. */
export const meshBuildJob = jsonJobOption(MESH_BUILD_FIELD, MESH_BUILD_OPTION, resolveMeshBuild)
