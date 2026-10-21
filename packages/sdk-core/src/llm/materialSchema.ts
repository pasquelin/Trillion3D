import {
  DEFAULT_TEMPORAL_AA_LEVEL,
  RESPONSIVE_EXTRA,
  TEMPORAL_AA_EXTRA,
  TEMPORAL_AA_LEVELS,
  TEMPORAL_AA_SHARES,
  VOXELIZE_EXTRA,
} from '../contracts/compilerAbi.ts'
import { choiceOrFlag, nameOrMatch } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `temporalAntialiasing` option (`materialOptions.ts`, `resolveTemporalAntialiasing`), built by
 *  a call marked pure, as the material options below: each reads the levels and the shares, and a
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
    `The objects whose materials keep a responsive temporal anti-aliasing history (at most ${TEMPORAL_AA_SHARES.responsive} of it, the current image weighing at least a quarter), for fast effects such as sparks: the node's exact name, { regex, flags } on it, or a match object; a match naming material keeps only those materials. Below materials, above a material's own extras.${TEMPORAL_AA_EXTRA} and extras.${RESPONSIVE_EXTRA}.`,
  ))()

/** The `voxelize` option (`voxelizeOptions.ts`, `resolveVoxelize`). */
export const voxelize: JsonSchemaProperty = /* @__PURE__ */ (() =>
  nameOrMatch(
    `The objects whose meshes are voxelized far away: their DAG's coarse levels are bricks of voxels wherever voxels hold the error better than triangles, a leaf card's cut-out kept, for foliage and other thin parts. The node's exact name, { regex, flags } on it, or a match object. The objects of the HLOD foliage group are voxelized without it, and so is a mesh whose own extras.${VOXELIZE_EXTRA} is "voxelize".`,
  ))()

/** The `materials` option (`materialOptions.ts`, `resolveMaterials`), the named shares listed. */
export const materials: JsonSchemaProperty = /* @__PURE__ */ (() => {
  const names = Object.entries(TEMPORAL_AA_SHARES)
    .map(([name, share]) => `'${name}' (${share})`)
    .join(', ')
  return {
    type: 'object',
    description: `Settings by exact material name, each { temporalAntialiasing, responsive }, winning over responsive and the extras. temporalAntialiasing is the most of its history the temporal anti-aliasing keeps on its pixels: a number from 0 to 1 or one of ${names}; default 1. responsive: true is ${TEMPORAL_AA_SHARES.responsive}; false takes the material out of the responsive option and its extras.${RESPONSIVE_EXTRA}. A material's own glTF extras.${TEMPORAL_AA_EXTRA} names its share below the responsive option.`,
  }
})()
