import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { followLobes } from './lobesTarget.ts'
import { followTranslucency } from './targets.ts'

/**
 * At the start of every image whose view renders surfaces, before anything names the targets: the lobes target (full-size while a surface
 * wants it) and the translucency targets (their share) are each remade alone
 * when what they follow changed — the frame's other targets stay. One entry for every view that draws surfaces (`encodeVis`,
 * `encodeSkyMeshFace`).
 */
export function followTargets(rt: WebgpuPagesRuntime) {
  followLobes(rt)
  followTranslucency(rt)
}
