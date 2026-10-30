import {
  DEFAULT_RESPONSIVE_LEVEL,
  DEFAULT_TEMPORAL_AA_LEVEL,
  RESPONSIVE_EXTRA,
  RESPONSIVE_LEVELS,
  SKY_EXTRA,
  TEMPORAL_AA_LEVELS,
  VOXELIZE_EXTRA,
} from '../contracts/compilerAbi.ts'
import { choiceOrFlag, nameOrMatch } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `temporalAntialiasing` option (`materialOptions.ts`, `resolveTemporalAntialiasing`), built by
 *  a call marked pure, as the material options below: each reads the levels, and a
 *  bundle that never reads the schema drops it. */
export const temporalAntialiasing: JsonSchemaProperty = /* @__PURE__ */ (() =>
  choiceOrFlag(
    `The scene's temporal anti-aliasing quality level, written in its manifest: the runtime's scene setting, below the quality preset, the page and the editor; the first loaded scene naming it decides. true is ${DEFAULT_TEMPORAL_AA_LEVEL}, false is off. Default none: the runtime's own, ${DEFAULT_TEMPORAL_AA_LEVEL}.`,
    TEMPORAL_AA_LEVELS,
    'A quality level.',
    `true ${DEFAULT_TEMPORAL_AA_LEVEL}, false off.`,
  ))()

/** The `responsive` option (`materialOptions.ts`, `resolveResponsive`). */
export const responsive: JsonSchemaProperty = /* @__PURE__ */ (() =>
  nameOrMatch(
    `The objects whose materials are responsive in the temporal anti-aliasing (level ${DEFAULT_RESPONSIVE_LEVEL}: their pixels' history restarts every image), for fast effects such as sparks: the node's exact name, { regex, flags } on it, or a match object; a match naming material keeps only those materials. Below materials, above a material's own extras.${RESPONSIVE_EXTRA}.`,
  ))()

/** The `voxelize` option (`voxelizeOptions.ts`, `resolveVoxelize`). */
export const voxelize: JsonSchemaProperty = /* @__PURE__ */ (() =>
  nameOrMatch(
    `The objects whose meshes are voxelized far away: their DAG's coarse levels are bricks of voxels wherever voxels hold the error better than triangles, a leaf card's cut-out kept, for foliage and other thin parts. The node's exact name, { regex, flags } on it, or a match object. The objects of the HLOD foliage group are voxelized without it, and so is a mesh whose own extras.${VOXELIZE_EXTRA} is "voxelize".`,
  ))()

/** The `materials` option (`materialOptions.ts`, `resolveMaterials`), the levels listed. */
export const materials: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `Settings by exact material name, each { responsive, sky }, winning over the responsive option and the material's own extras.${RESPONSIVE_EXTRA} and extras.${SKY_EXTRA}. sky is true for the material of a sky dome mesh: the engine shows it as its colour alone, draws it as the sky after the opaque surfaces and captures it in place of the atmosphere in the sky light's real-time capture; default false. responsive is how far the temporal anti-aliasing trusts the history on the material's pixels: one of ${RESPONSIVE_LEVELS.map((level) => `'${level}'`).join(', ')} (off the normal accumulation; medium reads the pixels as a pixel animation and rejects their history more aggressively; full restarts their history every image), true is '${DEFAULT_RESPONSIVE_LEVEL}', false is 'off'; default 'off'.`,
}))()
