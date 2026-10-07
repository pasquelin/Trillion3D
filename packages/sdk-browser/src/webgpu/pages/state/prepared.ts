import type { WebgpuVisState } from './vis.ts'

/** The visibility path's parts prepare makes whole, or refuses the scene by name
 *  (`../prepare/visibility.ts`): one path, no second image configuration (#1483). */
type PreparedPart = 'gpuDraw' | 'gpuHiz' | 'gpuPartition'

/** `vis`'s `part`, read at frame time: never absent past prepare, so its absence is a broken
 *  invariant, said by name — never an image drawn another way. */
export function prepared<K extends PreparedPart>(
  vis: WebgpuVisState,
  part: K,
): NonNullable<WebgpuVisState[K]> {
  const value = vis[part]
  if (!value) throw new Error(`WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE: no ${part}`)
  return value as NonNullable<WebgpuVisState[K]>
}
