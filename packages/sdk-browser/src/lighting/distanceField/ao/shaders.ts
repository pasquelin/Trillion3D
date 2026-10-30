import { dfaoConeGlobalShader } from './coneGlobalWgsl.ts'
import { dfaoConeObjectsShader, type ConeObjectsShape } from './coneObjectsWgsl.ts'
import { DFAO_COMBINE_WGSL } from './combineWgsl.ts'
import {
  DFAO_CULL_OBJECTS_WGSL,
  DFAO_START_OFFSETS_WGSL,
  DFAO_TILE_CONES_WGSL,
} from './cullWgsl.ts'
import { DFAO_CLEAR_WGSL } from './gridWgsl.ts'
import {
  DFAO_FILTER_HISTORY_WGSL,
  DFAO_UPDATE_HISTORY_WGSL,
  DFAO_UPSAMPLE_ONLY_WGSL,
} from './historyWgsl.ts'
import { DFAO_NORMALS_WGSL } from './normalsWgsl.ts'
import { DFAO_PACK_WGSL } from './packWgsl.ts'
import { DFAO_OBJECT_CULL_WGSL } from './scatterWgsl.ts'

/** The key of the cone trace against the meshes' fields of a shape (`DFAO_SHADERS`). */
export const coneObjectsKey = (shape: ConeObjectsShape) =>
  `coneObjects${shape.global ? 'Global' : ''}${shape.traverseMips ? 'Mips' : ''}` as const

/**
 * EVERY PROGRAM OF THE DISTANCE-FIELD OCCLUSION, by name, each variant its own: the cones against the global field
 * with the meshes' fields traced beside it or without, against the meshes' fields with the global field tracing
 * the rest or not and climbing the mips or not. The passes compile these (`pipelines.ts`) and the list of the
 * engine's texts holds each.
 */
const dfaoShaders = (filterableMip: boolean) => ({
  normals: DFAO_NORMALS_WGSL,
  clear: DFAO_CLEAR_WGSL,
  coneGlobal: dfaoConeGlobalShader(false, filterableMip),
  coneGlobalObjects: dfaoConeGlobalShader(true, filterableMip),
  coneObjects: dfaoConeObjectsShader({ global: false, traverseMips: false }),
  coneObjectsMips: dfaoConeObjectsShader({ global: false, traverseMips: true }),
  coneObjectsGlobal: dfaoConeObjectsShader({ global: true, traverseMips: false }),
  coneObjectsGlobalMips: dfaoConeObjectsShader({ global: true, traverseMips: true }),
  combine: DFAO_COMBINE_WGSL,
  upsampleOnly: DFAO_UPSAMPLE_ONLY_WGSL,
  updateHistory: DFAO_UPDATE_HISTORY_WGSL,
  filterHistory: DFAO_FILTER_HISTORY_WGSL,
  pack: DFAO_PACK_WGSL,
  cullObjects: DFAO_CULL_OBJECTS_WGSL,
  tileCones: DFAO_TILE_CONES_WGSL,
  startOffsets: DFAO_START_OFFSETS_WGSL,
  scatter: DFAO_OBJECT_CULL_WGSL,
}) as const

const shadersHeld = new Map<boolean, ReturnType<typeof dfaoShaders>>()
/** The programs, made once for each value of `filterableMip`: whether the cones against the global field read its coarse mip through the hardware's filter. */
export const dfaoShadersOf = (filterableMip: boolean) => {
  let held = shadersHeld.get(filterableMip)
  if (!held) shadersHeld.set(filterableMip, (held = dfaoShaders(filterableMip)))
  return held
}

/** The programs with the coarse mip read by hand. */
export const DFAO_SHADERS = dfaoShadersOf(false)
