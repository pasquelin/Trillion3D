import {
  HLOD_SHAPE_PRESERVATIONS,
  HLOD_SHAPE_RULES,
  MESH_BUILD_OBJECTS,
  MESH_BUILD_RULES as rules,
  type MeshBuildSettingsWire,
} from '../contracts/compilerAbi.ts'
import {
  DEFAULT_NORMAL_PRECISION,
  DEFAULT_TANGENT_PRECISION,
  MAX_NORMAL_PRECISION,
  MAX_POSITION_PRECISION,
  MAX_TANGENT_PRECISION,
  MIN_POSITION_PRECISION,
} from '../page/format.ts'
import { int, ruleSchema, sceneAndRules } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The settings of one source of `meshBuild` (`meshBuildOptions.ts`): the scene's or a rule's. Each
 *  one's kind and bounds are its rule's (`MESH_BUILD_RULES`); the page format's bounds are the
 *  precisions'. */
const meshBuildSettings: Record<keyof MeshBuildSettingsWire, JsonSchemaProperty> =
  /* @__PURE__ */ (() => ({
    storedTangents: ruleSchema(
      rules.storedTangents,
      `Whether the pages store the build's tangents — the source's glTF TANGENT unless the build rebuilds them (recomputeNormals, recomputeTangents) or the source has none —, which the shading takes in place of the frame it rebuilds from the triangle (default ${rules.storedTangents.default}).`,
    ),
    keptTriangles: ruleSchema(
      rules.keptTriangles,
      `The share of the source's triangles the finest level may hold: under 1, the finest detail is cut away once the DAG is built, down to the coarsest cut holding more than that share (default ${rules.keptTriangles.default}).`,
    ),
    trimmedError: ruleSchema(
      rules.trimmedError,
      `The error the finest level must reach, in percent of the mesh's size (the square root of the smaller of twice its area and a quarter of its box's surface): above 0, the finest detail is cut away down to the coarsest cut whose error is under it (default ${rules.trimmedError.default}).`,
    ),
    dropNearCollapsed: ruleSchema(
      rules.dropNearCollapsed,
      `Whether a triangle two of whose corners lie within 200 nanometres of each other on every axis is dropped before the build; false drops only one two of whose corners are one point (default ${rules.dropNearCollapsed.default}).`,
    ),
    alwaysResidentKib: ruleSchema(
      rules.alwaysResidentKib,
      `How much of the mesh stays resident whatever the view, in KiB: its root pages, 32 KiB each, hold at least that much of its coarsest clusters, pinned in the geometry pool; 0 keeps one root page, the least (default ${rules.alwaysResidentKib.default}).`,
    ),
    recomputeNormals: ruleSchema(
      rules.recomputeNormals,
      `Whether the build rebuilds every normal from the triangles, two triangles sharing an edge smoothed together, the source's normals dropped, and every stored tangent with them; false keeps the source's, rebuilding only a normal that is nothing. A source without normals gets the rebuilt ones; a skinned mesh keeps its source's frames either way (default ${rules.recomputeNormals.default}).`,
    ),
    recomputeTangents: ruleSchema(
      rules.recomputeTangents,
      `Whether the build rebuilds every stored tangent; false keeps the source's when it keeps its normals too. Read only when the pages store tangents (default ${rules.recomputeTangents.default}).`,
    ),
    useMikkTSpace: ruleSchema(
      rules.useMikkTSpace,
      `Whether the tangents the build rebuilds are MikkTSpace's; false sums each vertex's triangles' tangents (default ${rules.useMikkTSpace.default}).`,
    ),
    computeWeightedNormals: ruleSchema(
      rules.computeWeightedNormals,
      `Whether the normals the build rebuilds weigh each triangle by its area times its angle at the vertex; false weighs them alike (default ${rules.computeWeightedNormals.default}).`,
    ),
    skinnedWeldPosition: ruleSchema(
      rules.skinnedWeldPosition,
      `How far, in metres on every axis, two corners of a skinned mesh may lie apart and be welded into one vertex (default ${rules.skinnedWeldPosition.default}).`,
    ),
    skinnedWeldNormal: ruleSchema(
      rules.skinnedWeldNormal,
      `How far, on every axis, two unit normals, tangents or bitangents of a skinned mesh may differ and their corners be welded into one vertex (default ${rules.skinnedWeldNormal.default}).`,
    ),
    skinnedWeldTexture: ruleSchema(
      rules.skinnedWeldTexture,
      `How far two texture coordinates of a skinned mesh may differ and their corners be welded into one vertex (default ${rules.skinnedWeldTexture.default}).`,
    ),
    positionPrecision: int(
      `The position grid of the mesh's pages: every position sits on cells of 2^-n centimetre. Left out, the precision follows the mesh's density — seven less the mean base-2 logarithm of the half-diagonal, in centimetres, of its finest clusters' boxes, never finer than a sixteenth of a centimetre — and falls as far as the widest cluster needs to fit 2^21 cells an axis.`,
      MIN_POSITION_PRECISION,
      MAX_POSITION_PRECISION,
    ),
    normalPrecision: int(
      `The bits an axis of the pages' octahedral normals (default ${DEFAULT_NORMAL_PRECISION}).`,
      1,
      MAX_NORMAL_PRECISION,
    ),
    tangentPrecision: int(
      `The bits of the angle of the stored tangents, their bitangent's sign one more (default ${DEFAULT_TANGENT_PRECISION}). Read only when the pages store tangents.`,
      0,
      MAX_TANGENT_PRECISION,
    ),
  }))()

/** A `merge` or `simplify` layer's `meshBuild` (`HLOD_MESH_BUILD_SETTINGS`): a mesh's own build
 *  settings but its tangents, and its shape's (`HLOD_SHAPE_RULES`). */
export const hlodMeshBuild: JsonSchemaProperty = /* @__PURE__ */ (() => {
  const shape = HLOD_SHAPE_RULES
  return {
    type: 'object',
    description:
      "How a merge or simplify layer builds the mesh of each actor it makes, as the reference reads it from those layers alone (an approximate layer's actors are built at every default): each setting its default when left out. alwaysResidentKib is what the actor's HLOD cell keeps resident while the actor is loaded.",
    properties: {
      keptTriangles: meshBuildSettings.keptTriangles,
      trimmedError: meshBuildSettings.trimmedError,
      dropNearCollapsed: meshBuildSettings.dropNearCollapsed,
      alwaysResidentKib: meshBuildSettings.alwaysResidentKib,
      shapePreservation: ruleSchema(
        shape.shapePreservation,
        `What the mesh keeps of its shape as its DAG is built: ${HLOD_SHAPE_PRESERVATIONS[0]}, or ${HLOD_SHAPE_PRESERVATIONS[1]}, its simplification keeping the area its border loses; voxels far away are a voxel layer's (default ${shape.shapePreservation.default}).`,
      ),
      edgeLengthBound: ruleSchema(
        shape.edgeLengthBound,
        `A collapse costs at least the square of each edge it makes over this bound, in units where the group's mean triangle is a quarter to a half of a unit across, so no long sliver appears; 0 bounds nothing (default ${shape.edgeLengthBound.default}).`,
      ),
      holdTextureCoordinates: ruleSchema(
        shape.holdTextureCoordinates,
        `Whether texture coordinates are taken from the vertices a collapse keeps instead of solved, counting nothing in the error, for texture sets holding values that do not blend (default ${shape.holdTextureCoordinates.default}).`,
      ),
    },
  }
})()

/** The `meshBuild` option (`meshBuildOptions.ts`, `resolveMeshBuild`). */
export const meshBuild: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `How each mesh is built: the settings for every mesh, and ${MESH_BUILD_OBJECTS}, rules setting them for the meshes of the objects a match names. For each setting of a mesh the first that names it wins: the first rule matching one of its objects, the scene's setting, the mesh's own glTF extras under the setting's name, the default.`,
  properties: sceneAndRules(meshBuildSettings, MESH_BUILD_OBJECTS, 'their meshes'),
}))()
