// The bytes the session holds beside its pools, within their budgets: the vertex buffers beside the
// geometry slots, the live textures beside the texture pool, and the host tables the streamer
// reserves for.
import { checkGeometryPoolBudget, type GeometryPool } from '../../../residency/pools.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { budgetBeside } from '../../residency/poolGrants.ts'
import { vertexBytesOf } from './metrics.ts'
import { impostorCardsBytes } from '../../../impostor/cards.ts'

/**
 * A geometry budget less the vertex buffers held beside its slots (`vertexBytesOf`, #487):
 * `geometryAllocationBytes` counts both, so the slots are drawn and granted from `bytes` and the
 * two never sum past the budget; `declared` records on the pool drawn the budget the host set.
 */
export function geometryBudgetBeside(rt: WebgpuPagesRuntime, budgetBytes: number) {
  checkGeometryPoolBudget(budgetBytes)
  const { bytes, deducted } = budgetBeside(budgetBytes, vertexBytesOf(rt.gpu, rt.vis))
  return {
    bytes,
    declared: (pool: GeometryPool) => ({ ...pool, budgetBytes: pool.budgetBytes + deducted }),
  }
}

/** Texture bytes held beside the texture pool, outside it, within the one texture budget: the live
 *  textures' working textures (#362). The impostor maps are tiles of the pool itself (#1527). */
export const textureBytesBeside = (rt: Pick<WebgpuPagesRuntime, 'vis'>) =>
  rt.vis.textures?.sources.liveBytes ?? 0

/** Host bytes the session holds for the streamer's reservation: the cut's tables and residency,
 *  plus the impostor tier's tables (`impostorCardsBytes`) and the proxy's instance words
 *  (`proxyHostBytes`). */
export function hostTableBytesOf(rt: WebgpuPagesRuntime) {
  const { services } = rt,
    impostors = rt.gpu.impostors
  const tier = impostors ? impostorCardsBytes(impostors) : 0
  return services.hostTableBytes() + tier + (rt.run.gpuSelection?.proxyHostBytes ?? 0)
}
