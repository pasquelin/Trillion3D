import type { EffectKind, EffectPass } from '../../../sdk-core/src/world/effect/chain.ts'
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_TEXEL_BYTES } from './bloomFilter.ts'
import { EFFECT_KIND_BYTES } from './kindBytes.ts'

/** Every built-in pass; a kind without its class here has no pass to draw (`never`). */
type BuiltIn = Bloom
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

/** Bytes per pixel of every pass target: `rgba16float`, the bloom's own format. */
const PASS_TEXEL_BYTES = BLOOM_TEXEL_BYTES
/**
 * Bytes of a chain's `targets` pass targets on a `width × height` image. Every kind holds its own
 * besides (`EFFECT_KIND_BYTES`). The one rule the renderer counts its targets by and the memory
 * budget reserves them by (`../residency/memoryBudget.ts`).
 */
export const effectTargetBytes = (width: number, height: number, targets: number) =>
  width * height * targets * PASS_TEXEL_BYTES

/** Every kind, read off the one table typed by all of them. */
export const EFFECT_KINDS = Object.keys(EFFECT_KIND_BYTES) as readonly EffectKind[]

/** Bytes of every target a chain may hold on a `width × height` image: two pass targets and every
 *  kind's own. */
export function effectChainBytesAt(width: number, height: number) {
  let bytes = effectTargetBytes(width, height, PASS_TARGETS)
  for (const kind of EFFECT_KINDS) bytes += EFFECT_KIND_BYTES[kind](width, height)
  return bytes
}
