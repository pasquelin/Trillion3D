// The bytes the session holds beside its pools: the live textures beside the texture pool, within
// its budget, and the host tables the streamer reserves for. The geometry pool's budget is its
// streaming slots' alone (`../../session/memory/pools.ts`).
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { budgetBeside } from '../../geometry/residency/poolGrants.ts'

/** Texture bytes held beside the texture pool, outside it, within the one texture budget: the live
 *  textures' working textures (#362). */
export const textureBytesBeside = (rt: Pick<WebgpuPagesRuntime, 'vis'>) =>
  rt.vis.textures?.sources.liveBytes ?? 0

/** A texture budget less the live textures held beside its pool (`textureBytesBeside`), and
 *  those `live` bytes. */
export function textureBudgetBeside(rt: Pick<WebgpuPagesRuntime, 'vis'>, budgetBytes: number) {
  const live = textureBytesBeside(rt)
  return { live, ...budgetBeside(budgetBytes, live) }
}

/** Host bytes the session holds for the streamer's reservation: the cut's tables and residency,
 *  plus the placements' boxes (`placementBoxesBytes`). */
export function hostTableBytesOf(rt: WebgpuPagesRuntime) {
  return rt.services.hostTableBytes() + (rt.run.gpuSelection?.placementBoxesBytes ?? 0)
}
