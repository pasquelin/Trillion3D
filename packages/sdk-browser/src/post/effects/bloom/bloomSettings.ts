import { BLOOM_RULES, type BloomValues } from '../../../../../sdk-core/src/contracts/bloomRules.ts'
import { settingsWatch } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The view's reading of the bloom's settings, kept from image to image (`bloomValues`). */
export type BloomWatch = ReturnType<typeof settingsWatch<typeof BLOOM_RULES>>

/** How the view draws the bloom (`BLOOM_RULES`), as the session holds the settings: one object,
 *  the same at each call, overwritten by it. */
export function bloomValues(rt: WebgpuPagesRuntime): BloomValues {
  const watch = (rt.gpu.bloomWatch ??= settingsWatch(BLOOM_RULES))
  return watch.read(rt.context)
}

/** Whether the bloom's settings moved since the image before: one that shows the bloom is drawn
 *  again (`effectsMoved`). Nothing before an image read them. */
export function bloomSettingsMoved(rt: WebgpuPagesRuntime) {
  const watch = rt.gpu.bloomWatch
  if (!watch) return false
  watch.read(rt.context)
  return watch.moved
}
