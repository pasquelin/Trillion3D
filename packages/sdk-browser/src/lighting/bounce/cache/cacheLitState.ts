import type { LitListResources } from '../../reflections/hitLighting/listPasses.ts'
import {
  cacheLitAdmitted,
  cacheLitRefused,
  cacheLitWanted,
  type CacheHitLighting,
  type CacheLitRefusal,
} from './cacheHitLit.ts'

/** What the radiance cache keeps of its hit lighting between two images. */
export interface CacheLitHolder {
  /** The hit lighting's lists and radiance, made on the first update that lights the rays' hits where they stand; none while the setting is off. */
  hitLit: LitListResources | undefined
  /** The hit lighting's resources (or its marks texture, or its kernels) were refused: the rays are lit from the cards (the word says so, the maps traced anew once) until the refusal's wait ends, whatever the slice; the setting no longer asking it clears it. */
  litRefusal: CacheLitRefusal | undefined
  /** The kernel sets whose current refusal was recorded: a refusal is recorded once per set when the set reports it, not each image it stays refused; a compile in flight or a landing of that set ends the event. */
  litRefusedSets: WeakSet<object>
  /** The mode word the maps' rays were last lit with (0: from the cards): the maps held are traced anew when it changes. */
  litWord: number | undefined
  /** Whether the last image that decided (settings and cache's reach) wanted the rays lit where their hits stand: an image with no information is then not updated, its probes waiting for the next. */
  litWanted: boolean
}

/** Whether an image has no information on the hit lighting (`hit` undefined) while the last decided one wanted it (and the cache still casts through the triangles): its update is left for the next image, so that the maps are not made with the cards' light and made again. */
export const cacheLitUndecided = (
  holder: Pick<CacheLitHolder, 'litWanted'>,
  hit: CacheHitLighting | null | undefined,
  castsThrough: boolean,
) => hit === undefined && castsThrough && holder.litWanted

/** The hit lighting's resources given back, and the refusal of them forgotten. */
export function releaseHitLit(holder: Pick<CacheLitHolder, 'hitLit' | 'litRefusal'>) {
  dropHitLitLists(holder)
  holder.litRefusal = undefined
}

/** The hit lighting's lists and radiance given back, the refusal (if any) kept. */
function dropHitLitLists(holder: Pick<CacheLitHolder, 'hitLit'>) {
  holder.hitLit?.dispose()
  holder.hitLit = undefined
}

/** The hit lighting given back where the image's settings no longer light the hits where they stand (or the cache no longer casts through the triangles): the one place a setting that turns off lets it go, whether or not an update is queued. True where it is not wanted (the host then gives back the marks texture it held for it). */
export function followHitLit(
  holder: Pick<CacheLitHolder, 'hitLit' | 'litRefusal' | 'litWanted'>,
  hit: CacheHitLighting | null | undefined,
  castsThrough: boolean,
) {
  // An image with no information (`hit` undefined: the deferred program not ready, a device swap) keeps the state; it is given back where the settings say it is not wanted (`hit` null, or settings that do not light the probes) or the cache stops casting through the triangles.
  if (hit === undefined && castsThrough) return false
  const wanted = cacheLitWanted({ hit }, castsThrough)
  holder.litWanted = wanted
  if (!wanted) releaseHitLit(holder)
  return !wanted
}

/** A refusal (the lists, the marks texture, the kernels): the resources are given back and the wait is that of the refusals in a row. */
export function refuseHitLit(holder: CacheLitHolder, tiles: number, now: number) {
  const refused = cacheLitRefused(holder.litRefusal, tiles, now)
  releaseHitLit(holder)
  holder.litRefusal = refused
}

/** An image lit its hits at a slice of `tiles` tiles: the refusal is kept unless that slice (or enough smaller ones in a row) was admitted. */
export function admitHitLit(holder: CacheLitHolder, tiles: number) {
  holder.litRefusal = cacheLitAdmitted(holder.litRefusal, tiles)
}

/** What the image does with the hit lighting's kernels: `cards` (they are not ready, or a refusal waits, or this one was recorded already: the rays are lit from the cards), `refused` (the device refused them just now: as `cards`, and a refusal to record, once), `lit` (the kernels are ready) or `none` (the settings do not ask them). */
export type CacheLitKernelsStep = 'cards' | 'refused' | 'lit' | 'none'

/**
 * Where the image stands on the hit lighting's kernels (`kernels`: those of the held set, none where the settings do not ask them). The kernels are looked at every image, a refusal that waits included (the consumer of the mask hold is asked every image by the caller, so that a long wait does not make the hold forget it), so that a refusal is recorded once per set, as the set reports it.
 * The probes are always updated, never held for a compile: the kernels compiling or refused leave them lit from the cards (plain trace or march), and the maps are traced anew once when the kernels land, by the change of the word.
 */
export function cacheLitKernelsStep(
  holder: Pick<CacheLitHolder, 'litRefusedSets'>,
  kernels: { readonly ready: boolean; readonly pending: boolean } | undefined,
  waiting: boolean,
): CacheLitKernelsStep {
  if (!kernels) return 'none'
  if (kernels.ready || kernels.pending) {
    holder.litRefusedSets.delete(kernels)
    return kernels.ready && !waiting ? 'lit' : 'cards'
  }
  // Recorded when it can be: one seen during another refusal's wait stays unrecorded until that wait ends, so that it is reported and backed off then.
  if (waiting || holder.litRefusedSets.has(kernels)) return 'cards'
  holder.litRefusedSets.add(kernels)
  return 'refused'
}

/** Whether the word the maps' rays are lit with moved: the light the maps hold was made another way and every probe is traced anew (`remade`, the one retrace mechanism of the hit lighting). */
export function litWordMoved(holder: Pick<CacheLitHolder, 'litWord'>, word: number) {
  const moved = holder.litWord !== undefined && holder.litWord !== word
  holder.litWord = word
  return moved
}

/**
 * The trace of an image that lights its hits where they stand when `traceLit` is given: `traceLit()` first, none where the marks texture was refused (it then built nothing and held nothing). Refused, the lists are given back before the plain trace (their budget must not refuse the plain atlas),
 * and the rays are cast again plain at the same slice (`tracePlain`) and the refusal is recorded where the plain atlas fits (the marks texture alone was refused: the word is the cards' for the whole wait and does not flip with each image) or where the plain kernels are not ready
 * (`plainReady` false: the same backoff, no list made again each image); where the plain kernels are ready and the plain atlas is refused it is a budget refusal of the atlas, not of the hit lighting, with no wait: the next image asks again. `cards` then true. Admitted, the image counts toward the refusal's end.
 */
export function traceLitOrCards<T, P extends { splat?: unknown }>(
  holder: CacheLitHolder,
  tiles: number,
  now: number,
  traceLit: (() => T | undefined) | undefined,
  tracePlain: () => P,
  plainReady = true,
) {
  const lit = traceLit?.()
  if (lit !== undefined) {
    admitHitLit(holder, tiles)
    return { trace: lit, cards: false }
  }
  if (traceLit) dropHitLitLists(holder)
  const plain = tracePlain()
  if (!traceLit) return { trace: plain, cards: false }
  if (plain.splat !== undefined || !plainReady) refuseHitLit(holder, tiles, now)
  return { trace: plain, cards: true }
}
