import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import type { DepthOfField } from '../../../../sdk-core/src/world/effect/depthOfField.ts'
import type { MotionBlur } from '../../../../sdk-core/src/world/effect/motionBlur.ts'
import type { Outline } from '../../../../sdk-core/src/world/effect/outline.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { EFFECT_KINDS, KIND_RULES } from './kindRules.ts'
import { finishBytesAt } from '../finish/finishBytes.ts'

/** Every built-in pass; a kind without its class here has no pass to draw (`never`). */
type BuiltIn = DepthOfField | MotionBlur | Bloom | Outline
/** The pass of one kind: what a renderer's implementation of that kind draws. */
export type EffectPassOf<K extends EffectKind> = Extract<BuiltIn, { kind: K }>

/** Counts the passes of each kind into `counts`, which it returns: nothing is allocated. */
export function countKinds(passes: readonly EffectPass[], counts: Record<EffectKind, number>) {
  for (const kind of EFFECT_KINDS) counts[kind] = 0
  for (const pass of passes) counts[pass.kind]++
  return counts
}

/** Pass targets a chain holds at most: each pass writes the next of two, in turn. */
const PASS_TARGETS = 2
/** Pass targets a chain of `passes` passes holds. */
export const effectPassTargets = (passes: number) => Math.min(passes, PASS_TARGETS)

/**
 * Bytes of a chain's `targets` pass targets on a `width × height` image, each made in `HDR_FORMAT`
 * (`webgpuEffects.ts`). Every kind holds its own
 * besides (`KIND_RULES[kind].bytes`). The one rule the renderer counts its targets by and the memory
 * budget reserves them by (`../../session/memory/memoryBudget.ts`).
 */
export const effectTargetBytes = (width: number, height: number, targets: number) =>
  (textureBytesOf({ size: [width, height], format: HDR_FORMAT }) ?? 0) * targets

/** Bytes of every target a chain may hold on a `width × height` image: two pass targets, every
 *  kind's own and the display finishing's, which the bloom shares with the local exposure
 *  (`../finish/finishBytes.ts`). */
export function effectChainBytesAt(width: number, height: number) {
  let bytes = effectTargetBytes(width, height, PASS_TARGETS) + finishBytesAt(width, height)
  for (const kind of EFFECT_KINDS) bytes += KIND_RULES[kind].bytes(width, height)
  return bytes
}
