import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import type { Outline } from '../../../../sdk-core/src/world/effect/outline.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { EFFECT_KIND_BYTES } from './kindBytes.ts'
import { finishBytesAt } from '../finish/finishBytes.ts'

/** Every built-in pass; a kind without its class here has no pass to draw (`never`). */
type BuiltIn = Bloom | Outline
/** The pass of one kind: what a renderer's implementation of that kind draws. */
export type EffectPassOf<K extends EffectKind> = Extract<BuiltIn, { kind: K }>

/** Writes into `into` the passes of `passes` that draw — an idle pass has nothing to draw: the one
 *  place a pass is told idle —, in order, and returns it: nothing is allocated. An idle pass
 *  counts for no kind: its code is not loaded (`ready`), nor its targets made (`overlay`), until
 *  the first image it has something to draw — which then waits for its code. */
export function activePasses(passes: readonly EffectPass[], into: EffectPass[]) {
  into.length = 0
  for (const pass of passes) if (!pass.idle) into.push(pass)
  return into
}

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
 * besides (`EFFECT_KIND_BYTES`). The one rule the renderer counts its targets by and the memory
 * budget reserves them by (`../../session/memory/memoryBudget.ts`).
 */
export const effectTargetBytes = (width: number, height: number, targets: number) =>
  (textureBytesOf({ size: [width, height], format: HDR_FORMAT }) ?? 0) * targets

/** Every kind, read off the one table typed by all of them. */
export const EFFECT_KINDS = Object.keys(EFFECT_KIND_BYTES) as readonly EffectKind[]

/** Bytes of every target a chain may hold on a `width × height` image: two pass targets, every
 *  kind's own and the display finishing's, which the bloom shares with the local exposure
 *  (`../finish/finishBytes.ts`). */
export function effectChainBytesAt(width: number, height: number) {
  let bytes = effectTargetBytes(width, height, PASS_TARGETS) + finishBytesAt(width, height)
  for (const kind of EFFECT_KINDS) bytes += EFFECT_KIND_BYTES[kind](width, height)
  return bytes
}
