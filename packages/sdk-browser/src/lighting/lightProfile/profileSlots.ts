import type { LightProfileData } from './profileFile.ts'

/** Slices the atlas holds at most: the profiles beyond them light as a lamp with none. The reference's
 *  capacity of its profile atlas, and what a light's profile lane can name (`LIGHT_PROFILE_SLICES`). */
export const PROFILE_ATLAS_MAX_SLICES = 32

/** A profile the atlas holds a place for: the lights that name it, the slice its texels are in (−1
 *  until it has one), its data. */
interface Slot {
  data: LightProfileData
  refs: number
  slice: number
  /** Whether the data was replaced since it was last written into the slice. */
  dirty: boolean
}

/** The writes a plan asks of the atlas: each upload's texels into its slice. */
export type AtlasUploads = readonly { readonly slice: number; readonly data: LightProfileData }[]

const NO_UPLOADS: AtlasUploads = []

/**
 * The places of the light profiles in the atlas, one for each distinct profile however many lights
 * name it, found by the profile's id (`add`, `remove`, `sliceOf`). A slice is where a profile's texels
 * are in the atlas's texture, −1 for none. Slices are handed out first-freed first; a profile added or
 * replaced after the last plan waits for the next one (`plan`), which gives it a free slice and writes it. Profiles beyond
 * `maxSlices` have no slice, and take one the moment another is freed.
 */
export function createProfileSlots(maxSlices = PROFILE_ATLAS_MAX_SLICES) {
  const slots = new Map<string, Slot>()
  const free = Array.from({ length: maxSlices }, (_, slice) => slice)
  let pending = false

  return {
    /** One more light names profile `id`; its data is kept from the first. */
    add(id: string, data: LightProfileData) {
      const held = slots.get(id)
      if (held) {
        held.refs++
        return
      }
      slots.set(id, { data, refs: 1, slice: -1, dirty: true })
      pending = true
    },
    /** Profile `id` was registered again with other `data`: it is written again into its slice, whose lights keep it. A profile
     *  not held, or whose data is that held, is left as it is. */
    update(id: string, data: LightProfileData) {
      const held = slots.get(id)
      if (!held || held.data === data) return
      held.data = data
      held.dirty = true
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
    /** The number of lights that name profile `id`. */
    refsOf: (id: string) => slots.get(id)?.refs ?? 0,
    /** The slices to write now: each profile held without one is given a free slice. Nothing when
     *  nothing was added or freed since the last plan. */
    plan(): AtlasUploads {
      if (!pending) return NO_UPLOADS
      pending = false
      const uploads: { slice: number; data: LightProfileData }[] = []
      for (const slot of slots.values()) {
        if (slot.slice < 0) {
          const slice = free.shift()
          if (slice === undefined) break
          slot.slice = slice
        } else if (!slot.dirty) continue
        slot.dirty = false
        uploads.push({ slice: slot.slice, data: slot.data })
      }
      return uploads
    },
  }
}

/** The places of the light profiles. */
export type ProfileSlots = ReturnType<typeof createProfileSlots>
