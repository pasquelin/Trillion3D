import type { LightProfileData } from './profileCodec.ts'

/** A profile the atlas holds a place for: the lights that name it, the slice its texels are in (−1
 *  until it has one), its data. */
interface Slot {
  data: LightProfileData
  refs: number
  slice: number
}

/** The writes a plan asks of the atlas: each upload's texels into its slice. */
export type AtlasUploads = readonly { readonly slice: number; readonly data: LightProfileData }[]

const NO_UPLOADS: AtlasUploads = []

/**
 * The places of the light profiles in the atlas, one for each distinct profile however many lights
 * name it, found by the profile's id (`add`, `remove`, `sliceOf`). A slice is where a profile's texels
 * are in the atlas's texture, −1 for none. Slices are handed out first-freed first; a profile added
 * after the last plan waits for the next one (`plan`), which gives it a free slice and writes it. Profiles beyond
 * the atlas's `sliceCount` have no slice, and take one the moment another is freed. The atlas made again (`relayout`)
 * takes every slice back, and the next plan gives them out and writes them all again.
 */
export function createProfileSlots(sliceCount = 0) {
  const slots = new Map<string, Slot>()
  let free = Array.from({ length: sliceCount }, (_, slice) => slice)
  let pending = false

  return {
    /** One more light names profile `id`; its data is kept from the first. */
    add(id: string, data: LightProfileData) {
      const held = slots.get(id)
      if (held) {
        held.refs++
        return
      }
      slots.set(id, { data, refs: 1, slice: -1 })
      pending = true
    },
    /** One light fewer names profile `id`; the last frees its slice. */
    remove(id: string) {
      const held = slots.get(id)
      if (!held || --held.refs > 0) return
      slots.delete(id)
      if (held.slice >= 0) {
        free.push(held.slice)
        pending = true
      }
    },
    /** The slice of profile `id`'s texels in the atlas, −1 for none: not yet written, over the
     *  atlas's slices, or not held. */
    sliceOf: (id: string) => slots.get(id)?.slice ?? -1,
    /** The number of profiles held, however many lights name each. */
    get size() {
      return slots.size
    },
    /** The atlas is made again with `count` slices: every profile loses its slice, and the next plan gives them out again. */
    relayout(count: number) {
      for (const slot of slots.values()) slot.slice = -1
      free = Array.from({ length: count }, (_, slice) => slice)
      pending = true
    },
    /** The number of lights that name profile `id`. */
    refsOf: (id: string) => slots.get(id)?.refs ?? 0,
    /** The slices to write now: each profile held without one is given a free slice. Nothing when
     *  nothing was added or freed since the last plan. */
    plan(): AtlasUploads {
      if (!pending) return NO_UPLOADS
      pending = false
      const uploads: { slice: number; data: LightProfileData }[] = []
      for (const slot of slots.values()) {
        if (slot.slice >= 0) continue
        const slice = free.shift()
        if (slice === undefined) break
        slot.slice = slice
        uploads.push({ slice, data: slot.data })
      }
      return uploads
    },
  }
}
