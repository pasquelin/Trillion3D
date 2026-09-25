import type { EffectKind, EffectPass } from '../../../sdk-core/src/world/effect/chain.ts';
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import { BLOOM_TEXEL_BYTES, bloomLevelBytes } from './bloomFilter.ts';

/** Every built-in pass; a kind without its class here has no pass to draw (`never`). */
type BuiltIn = Bloom;
/** The pass of one kind: what a renderer's implementation of that kind draws. */
export type EffectPassOf<K extends EffectKind> = Extract<BuiltIn, { kind: K }>;

/** Counts the passes of each kind into `counts`, which it returns: nothing is allocated. */
export function countKinds(passes: readonly EffectPass[], counts: Record<EffectKind, number>) {
  for (const kind of EFFECT_KINDS) counts[kind] = 0;
  for (const pass of passes) counts[pass.kind]++;
  return counts;
}

/** Pass targets a chain holds at most: each pass writes the next of two, in turn. */
const PASS_TARGETS = 2;
/** Pass targets a chain of `passes` passes holds. */
export const effectPassTargets = (passes: number) => Math.min(passes, PASS_TARGETS);

/** Bytes per pixel of every pass target: `rgba16float`, the bloom's own format. */
const PASS_TEXEL_BYTES = BLOOM_TEXEL_BYTES;
/** Bytes per pixel of the WebGL2 target the engine draws into: its half-float radiance, its 24-bit
 *  depth padded to four bytes, and the one-byte mark of the surfaces the curve skips. */
const SCENE_TEXEL_BYTES = PASS_TEXEL_BYTES + 4 + 1;

/**
 * Bytes of a chain's shared targets on a `width × height` image: `targets` pass targets and, on
 * WebGL2 (`scene`), the target the engine draws into; nothing without a pass target. Every kind
 * holds its own besides (`EFFECT_KIND_BYTES`). The one rule both renderers count their targets by
 * and the memory budget reserves them by (`../residency/memoryBudget.ts`).
 */
export function effectTargetBytes(width: number, height: number, targets: number, scene: boolean) {
  if (!targets) return 0;
  return width * height * (targets * PASS_TEXEL_BYTES + (scene ? SCENE_TEXEL_BYTES : 0));
}

/** Bytes each kind holds on a `width × height` image, whatever the number of its passes: they
 *  run one after the other on the same resources. */
export const EFFECT_KIND_BYTES: Record<EffectKind, (width: number, height: number) => number> = {
  bloom: bloomLevelBytes,
};

/** Every kind, read off the one table typed by all of them. */
export const EFFECT_KINDS = Object.keys(EFFECT_KIND_BYTES) as readonly EffectKind[];

/** Bytes of every target a chain may hold on a `width × height` image: two pass targets, the
 *  WebGL2 scene target, and every kind's own. */
export function effectChainBytesAt(width: number, height: number) {
  let bytes = effectTargetBytes(width, height, PASS_TARGETS, true);
  for (const kind of EFFECT_KINDS) bytes += EFFECT_KIND_BYTES[kind](width, height);
  return bytes;
}
