import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { followLobes } from './lobesTarget.ts'
import { followClosureLayers } from './closures.ts'
import { followTranslucency } from './targets.ts'

/**
 * At the start of every image whose view renders surfaces, before anything names the targets: the lobes target (full-size while a surface
 * wants it), the closure slices the view's most closures a pixel asks, and the translucency targets (their share) are each remade alone
 * when what they follow changed — the frame's other targets stay. One entry for every view that draws surfaces (`encodeVis`,
 * `encodeCustomDepthView`, `encodeSkyMeshFace`).
 */
export function followTargets(rt: WebgpuPagesRuntime) {
  followLobes(rt)
  followClosureLayers(rt)
  followTranslucency(rt)
}
