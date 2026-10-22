/**
 * How a mesh is built — the settings of `meshBuild` for every mesh of the scene and by object, and
 * those a `merge` or `simplify` layer names for its actors' meshes —, written once as a table of
 * rules (`settingRules.ts`): each setting's field, default, bounds and the words a refusal names it
 * by, which the job's resolver (`meshBuildOptions.ts`), the options schema and the compiler's Rust
 * (`scripts/build/shared-rules/abi.ts`) all read. The page format's own bounds — the three
 * precisions' — stay in `page/format.ts`, the resolver and the schema reading them there.
 */
import type { HlodWireMatch } from './hlodAbi.ts'
import { VOXELIZE_EXTRA } from './materialAbi.ts'
import {
  ANY_NUMBER,
  choiceSetting,
  countSetting,
  flagSetting,
  INT32_RANGE,
  integerSetting,
  nonNegativeSetting,
  numberSetting,
  rulesOf,
} from './settingRules.ts'

/** The job field setting how each mesh is built (`resolveMeshBuild`): the settings of
 *  `MESH_BUILD_SETTINGS` for every mesh of the scene, and under `MESH_BUILD_OBJECTS` the rules
 *  `{ match, …settings }` that set them for the meshes of the objects a match names — as
 *  `voxelize` names its objects. For each setting of a mesh, the first that names it wins: the
 *  first rule matching one of its objects, then the scene's setting, then the mesh's own glTF
 *  `extras` under the setting's name, then its default. The command line's `--mesh-build=` flag
 *  holds it as JSON. A job leaving it out keeps its cache key. */
export const MESH_BUILD_FIELD = 'meshBuild'
/** The command line's flag setting how each mesh is built, its JSON after the `=`. */
export const MESH_BUILD_OPTION = '--mesh-build='
/** The key of `meshBuild` holding its rules by object, in order. */
export const MESH_BUILD_OBJECTS = 'objects'
/** The most KiB a mesh's always-resident size may name: a 32-bit word's. */
export const MAX_ALWAYS_RESIDENT_KIB = 0xffffffff
/** The most rays a voxel casts (`voxelRays`): a larger count casts this many. */
export const MAX_VOXEL_RAYS = 1024
/** Rays are cast in packets of this many: a count past 1 is rounded up to a whole packet. */
export const VOXEL_RAY_PACKET = 16
/** A voxel no ray hit is sampled again a level up only when fewer rays than this were cast: with
 *  more, none hitting means the volume is empty. */
export const VOXEL_REMEMBER_BELOW_RAYS = 32

/** The settings of a mesh's build that have a default — the reference's —, by field, in the order
 *  `MESH_BUILD_SETTINGS` lists them:
 *  - `storedTangents`: whether a mesh's pages store its build's tangents, which the shading then
 *    takes in place of the frame it rebuilds from the triangle. They are the source's own
 *    (`TANGENT`) unless the build rebuilds them (`recomputeTangents`, `recomputeNormals`), or the
 *    source has none. A mesh stores none unless a setting names it.
 *  - `keptTriangles`: the share of a mesh's source triangles its finest level may hold, in [0, 1]:
 *    under 1, the finest detail is cut away once its DAG is built, down to the coarsest cut holding
 *    more than that share. A mesh keeps every source triangle unless a setting names a share.
 *  - `trimmedError`: the error a mesh's finest level must reach, at least 0, in percent of the
 *    mesh's size — the square root of the smaller of twice its area and a quarter of its box's
 *    surface: above 0, the finest detail is cut away once its DAG is built, down to the coarsest
 *    cut whose error is under it. A mesh's finest level reaches no error unless a setting names one.
 *  - `dropNearCollapsed`: whether a mesh's build drops a triangle two of whose corners lie within
 *    200 nanometres of each other on every axis (`true`), or only one two of whose corners are
 *    one point (`false`, the default).
 *  - `alwaysResidentKib`: how much of a mesh stays resident whatever the view, in KiB, a whole
 *    number from 0 to `MAX_ALWAYS_RESIDENT_KIB`: its root pages, of 32 KiB each, hold at least that
 *    much of its coarsest clusters, pinned in the geometry pool while the mesh is in the scene. 0
 *    keeps one root page, the least, the default; a size past the mesh keeps it all. Approximate,
 *    by whole pages.
 *  - `recomputeNormals`: whether a mesh's build rebuilds every normal from its triangles (`true`,
 *    the default), the source's own dropped — two triangles sharing an edge are smoothed together
 *    —, and every stored tangent with them; or keeps the source's (`false`), rebuilding only a
 *    normal that is nothing. A mesh whose source has no normals gets the rebuilt ones. A skinned
 *    mesh's build keeps the source's frames whatever the setting.
 *  - `recomputeTangents`: whether a mesh's build rebuilds every stored tangent from its triangles
 *    (`true`, the default), or keeps the source's (`false`) — when it keeps its normals too —,
 *    rebuilding only a tangent whose frame is not whole. Read only when the pages store tangents.
 *  - `useMikkTSpace`: whether the tangents a mesh's build rebuilds are MikkTSpace's (`true`, the
 *    default), or the sum of each vertex's triangles' (`false`).
 *  - `computeWeightedNormals`: whether the normals a mesh's build rebuilds weigh each triangle by
 *    its area times its angle at the vertex (`true`), or alike (`false`, the default).
 *  - `skinnedWeldPosition`: how far, in metres on every axis, two corners of a skinned mesh may
 *    lie apart and its build weld them into one vertex, a number of at least 0: 200 nanometres.
 *  - `skinnedWeldNormal`: how far, on every axis, two unit normals, tangents or bitangents of a
 *    skinned mesh may differ and its build weld their corners into one vertex, a number of at
 *    least 0: 2e-5.
 *  - `skinnedWeldTexture`: how far two texture coordinates of a skinned mesh may differ and its
 *    build weld their corners into one vertex, a number of at least 0: a 1024th.
 *  - `voxelRays`: how many rays are cast across each voxel of a voxelized mesh (`voxelize`) to
 *    sample its surface, a whole number of at least 0: 64. A count is cast as at most
 *    `MAX_VOXEL_RAYS`, and past 1 rounded up to a multiple of `VOXEL_RAY_PACKET`. 0 or 1 casts one
 *    ray: a voxel is then covered whole or not at all, and no coverage is handed over to its
 *    neighbours.
 *  - `voxelLevel`: the level of a voxelized mesh's DAG from which every group is voxels, a whole
 *    number a signed 32-bit word holds: 0, a group is voxels only where they are finer than its
 *    triangles. From 1, every group of that level or above is voxels whatever its triangles' error
 *    — 1 is the first level; a level below 0 acts as 1.
 *  - `voxelBackUp`: how far back, in voxel sides, each ray of a voxel starts before the voxel, a
 *    number: 0. A ray whose nearest hit lies in that stretch counts neither as a hit nor as a
 *    miss. Not read with `voxelSeparable`.
 *  - `voxelSeparable`: whether the rays of a voxel run along its three axes alone (`true`), each
 *    through one face, a hit counting only within the voxel's depth, and the voxel covered whole
 *    where every ray along an axis hits and a ray through its centre does; or in every direction
 *    (`false`, the default).
 *  - `voxelNdf`: whether a voxel keeps the spread of the normals its rays hit (`true`, the
 *    default): its normal is their mean and the shading roughens with its spread; or the
 *    direction of their mean alone, the spread dropped (`false`).
 *  - `voxelOpacity`: whether a voxel's record carries its coverage as its opacity (`true`), no
 *    coverage handed over to its neighbours, every voxel a ray hit kept; or none, the coverage
 *    handed over until no more voxels are left than it sums to (`false`, the default). The
 *    reference only gives that opacity to a material as the vertex colour and draws no voxel by
 *    it; the engine does not either.
 *  - `allowAssemblies`: whether the assembly a mesh's glTF `extras.assembly` names — parts, the
 *    meshes drawn once for each node that names them, and nodes, a part and a transform each — is
 *    built: each node of the assembly is then a node of the scene under every node that places the
 *    mesh, carrying its part's mesh, whose pages are written once however many nodes name it
 *    (`true`); or the mesh is its own triangles alone and the import report counts the assemblies
 *    left unbuilt (`false`, the default, as the reference does not build an assembly where its
 *    project switch is off). */
export const MESH_BUILD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flagSetting('storedTangents', false),
    numberSetting('keptTriangles', 1, [0, 1]),
    nonNegativeSetting('trimmedError', 0),
    flagSetting('dropNearCollapsed', false),
    integerSetting('alwaysResidentKib', 0, [0, MAX_ALWAYS_RESIDENT_KIB]),
    flagSetting('recomputeNormals', true),
    flagSetting('recomputeTangents', true),
    flagSetting('useMikkTSpace', true),
    flagSetting('computeWeightedNormals', false),
    nonNegativeSetting('skinnedWeldPosition', 2e-7),
    nonNegativeSetting('skinnedWeldNormal', 0.00002),
    nonNegativeSetting('skinnedWeldTexture', 1 / 1024),
    countSetting('voxelRays', 64, 0),
    integerSetting('voxelLevel', 0, INT32_RANGE),
    numberSetting('voxelBackUp', 0, ANY_NUMBER),
    flagSetting('voxelSeparable', false),
    flagSetting('voxelNdf', true),
    flagSetting('voxelOpacity', false),
    flagSetting('allowAssemblies', false),
  ]))()
/** The precision of a mesh's position grid, a whole number from `MIN_POSITION_PRECISION` to
 *  `MAX_POSITION_PRECISION` (`page/format.ts`): its pages place every position on cells of
 *  `2^-n` centimetre. Left out, the precision follows the mesh's density — seven less the mean base-2
 *  logarithm, rounded, of the half-diagonal in centimetres of its finest clusters' boxes, never
 *  finer than a sixteenth of a centimetre — and falls as far as the widest cluster needs to fit
 *  2^21 cells an axis. */
export const POSITION_PRECISION_SETTING = 'positionPrecision'
/** The bits an axis of a mesh's octahedral normals, a whole number from 1 to
 *  `MAX_NORMAL_PRECISION` (`page/format.ts`); left out, 8. */
export const NORMAL_PRECISION_SETTING = 'normalPrecision'
/** The bits of the angle of a mesh's stored tangents (`storedTangents`), a whole number
 *  from 0 to `MAX_TANGENT_PRECISION` (`page/format.ts`), their bitangent's sign one more; left out,
 *  7. */
export const TANGENT_PRECISION_SETTING = 'tangentPrecision'
/** The settings a mesh's build reads, `meshBuild` and each of its rules naming any of them: the
 *  fields of `MESH_BUILD_RULES` in order, then the three precisions. */
export const MESH_BUILD_SETTINGS = [
  'storedTangents',
  'keptTriangles',
  'trimmedError',
  'dropNearCollapsed',
  'alwaysResidentKib',
  'recomputeNormals',
  'recomputeTangents',
  'useMikkTSpace',
  'computeWeightedNormals',
  'skinnedWeldPosition',
  'skinnedWeldNormal',
  'skinnedWeldTexture',
  'voxelRays',
  'voxelLevel',
  'voxelBackUp',
  'voxelSeparable',
  'voxelNdf',
  'voxelOpacity',
  'allowAssemblies',
  POSITION_PRECISION_SETTING,
  NORMAL_PRECISION_SETTING,
  TANGENT_PRECISION_SETTING,
] as const satisfies readonly (keyof MeshBuildSettingsWire)[]

/** How a mesh's source is read as the compiler reads it, each left out when not named: never an
 *  HLOD layer's, whose builders keep the frames they make. */
export type MeshInputSettingsWire = {
  recomputeNormals?: boolean
  recomputeTangents?: boolean
  useMikkTSpace?: boolean
  computeWeightedNormals?: boolean
  skinnedWeldPosition?: number
  skinnedWeldNormal?: number
  skinnedWeldTexture?: number
}
/** How a voxelized mesh's voxels are sampled as the compiler reads it, each left out when not named:
 *  a `voxel` layer's `meshBuild` names these alone, a `merge` or `simplify` layer's none. */
export type MeshVoxelSettingsWire = {
  voxelRays?: number
  voxelLevel?: number
  voxelBackUp?: number
  voxelSeparable?: boolean
  voxelNdf?: boolean
  voxelOpacity?: boolean
}
/** Whether a mesh's assembly is built, as the compiler reads it, left out when not named: never an
 *  HLOD layer's, whose actors' meshes have none. */
export type MeshAssemblySettingsWire = {
  allowAssemblies?: boolean
}
/** One source's mesh build settings as the compiler reads them, each left out when not named. */
export type MeshBuildSettingsWire = MeshInputSettingsWire &
  MeshVoxelSettingsWire &
  MeshAssemblySettingsWire & {
    storedTangents?: boolean
    keptTriangles?: number
    trimmedError?: number
    dropNearCollapsed?: boolean
    alwaysResidentKib?: number
    positionPrecision?: number
    normalPrecision?: number
    tangentPrecision?: number
  }
/** The mesh build settings as the compiler reads them (`resolveMeshBuild` writes them). */
export type MeshBuildWire = MeshBuildSettingsWire & {
  objects?: (MeshBuildSettingsWire & { match: HlodWireMatch })[]
}

/** What an HLOD actor's mesh keeps of its shape as its DAG is built (`VOXELIZE_EXTRA`, its key):
 *  `none`, or `area`, its simplification keeping the area its border loses. Voxels far away are a
 *  `voxel` layer's. */
export const HLOD_SHAPE_PRESERVATIONS = ['none', 'area'] as const
/** One of `HLOD_SHAPE_PRESERVATIONS`. */
type HlodShapePreservation = (typeof HLOD_SHAPE_PRESERVATIONS)[number]
/** How a mesh keeps its shape as its DAG is built, each setting also the key of a glTF mesh's
 *  `extras` naming it, its default the reference's:
 *  - `shapePreservation` (`VOXELIZE_EXTRA`): a mesh keeps no shape apart unless a setting names one.
 *  - `edgeLengthBound`: the bound on the edges a mesh's simplification makes, a number of at least
 *    0: a collapse costs at least the square of each edge it makes over it, in units where the
 *    group's mean triangle is a quarter to a half of a unit across, so no long sliver appears; 0
 *    bounds nothing, the default.
 *  - `holdTextureCoordinates`: whether a mesh's simplification takes its texture coordinates from
 *    the vertices a collapse keeps instead of solving them, counting nothing of them in the error
 *    — for texture sets holding values that do not blend, as indices —: `true` or `false`, the
 *    default. */
export const HLOD_SHAPE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    choiceSetting(VOXELIZE_EXTRA, 'none', HLOD_SHAPE_PRESERVATIONS),
    nonNegativeSetting('edgeLengthBound', 0),
    flagSetting('holdTextureCoordinates', false),
  ]))()
/** The settings a `merge` or `simplify` layer's `meshBuild` names for the mesh of each actor it
 *  builds, as the reference reads them from the layer: what its finest level keeps, whether its
 *  near-collapsed triangles are dropped and its always-resident size — a mesh's own settings,
 *  `meshBuild`'s —, and how it keeps its shape (`HLOD_SHAPE_RULES`); each its default, the
 *  reference's, when left out. An actor's mesh stores the tangents its builder bakes, none other. */
export const HLOD_MESH_BUILD_SETTINGS = [
  'keptTriangles',
  'trimmedError',
  'dropNearCollapsed',
  'alwaysResidentKib',
  VOXELIZE_EXTRA,
  'edgeLengthBound',
  'holdTextureCoordinates',
] as const satisfies readonly (keyof HlodBuiltMeshWire)[]
/** A `merge` or `simplify` layer's `meshBuild` as the compiler reads it
 *  (`HLOD_MESH_BUILD_SETTINGS`), each setting left out when not named. */
export type HlodBuiltMeshWire = Omit<
  MeshBuildSettingsWire,
  | 'storedTangents'
  | keyof MeshInputSettingsWire
  | keyof MeshVoxelSettingsWire
  | keyof MeshAssemblySettingsWire
> & {
  shapePreservation?: HlodShapePreservation
  edgeLengthBound?: number
  holdTextureCoordinates?: boolean
}
/** A layer's `meshBuild` as the compiler reads it: a `merge` or `simplify` layer's, naming how the
 *  mesh of each actor it builds is built, or a `voxel` layer's, naming how its cells' voxels are
 *  sampled (`MeshVoxelSettingsWire`) and nothing else; each setting left out when not named. */
export type HlodMeshBuildWire = HlodBuiltMeshWire | MeshVoxelSettingsWire
