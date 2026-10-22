import type { EffectKind } from '../../../../sdk-core/src/world/effect/chain.ts'
import { bloomBytes } from './bloom/bloomFilter.ts'
import { motionBlurBytes } from './motionBlur/motionBlurLayout.ts'
import { outlineBytes } from './outline/outlineTarget.ts'

/** Bytes each kind holds on a `width × height` image, whatever the number of its passes: they
 *  run one after the other on the same resources. */
export const EFFECT_KIND_BYTES: Record<EffectKind, (width: number, height: number) => number> = {
  // Off until a focus distance is set: nothing is reserved for it, its images are held — and counted
  // by the budget as held (`ActiveGpuMemory.effectTargets`) — only while it draws.
  depthOfField: () => 0,
  motionBlur: motionBlurBytes,
  bloom: bloomBytes,
  outline: outlineBytes,
}
