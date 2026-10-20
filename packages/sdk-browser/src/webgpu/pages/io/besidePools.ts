// The bytes the session holds beside its pools, within their budgets: the vertex buffers beside the
// geometry slots, the live textures beside the texture pool, and the host tables the streamer
// reserves for.
import { checkGeometryPoolBudget, type GeometryPool } from '../../../residency/pools.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { budgetBeside } from '../../residency/poolGrants.ts'
import { vertexBytesOf } from './metrics.ts'

/**
 * A geometry budget less the vertex buffers held beside its slots (`vertexBytesOf`, #487):
 * `geometryAllocationBytes` counts both, so the slots are drawn and granted from `bytes` and the
 * two never sum past the budget; `declared` records on the pool drawn the budget the host set.
 */
export function geometryBudgetBeside(rt: WebgpuPagesRuntime, budgetBytes: number) {
  checkGeometryPoolBudget(budgetBytes)
  const { bytes, deducted } = budgetBeside(budgetBytes, vertexBytesOf(rt.vis))
  return {
    bytes,
    declared: (pool: GeometryPool) => ({ ...pool, budgetBytes: pool.budgetBytes + deducted }),
  }
}

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
 *  plus the proxy's instance words (`proxyHostBytes`). */
export function hostTableBytesOf(rt: WebgpuPagesRuntime) {
  return rt.services.hostTableBytes() + (rt.run.gpuSelection?.proxyHostBytes ?? 0)
}
