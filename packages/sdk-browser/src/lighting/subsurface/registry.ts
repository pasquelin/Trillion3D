import {
  resolveSubsurfaceProfile,
  type SubsurfaceProfile,
  type SubsurfaceProfileInput,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'

/** The most profiles the table holds beside the default skin's row 0. */
const MAX_REGISTERED_PROFILES = 255

const profiles: SubsurfaceProfile[] = []
const rows = new Map<string, number>()
let revision = 0

/**
 * THE PROFILES THE MATERIALS NAME, collected as the materials are declared: the row of the profile table a material's
 * `subsurfaceProfile` takes — 0, the default skin's, for none; else a row from 1, the same row for the same profile (its fields as the
 * default skin's complete them, `resolveSubsurfaceProfile`). Throws past 255 distinct profiles.
 */
export function subsurfaceProfileRow(input: SubsurfaceProfileInput | null | undefined) {
  if (!input) return 0
  const profile = resolveSubsurfaceProfile(input)
  const key = JSON.stringify(profile)
  const known = rows.get(key)
  if (known !== undefined) return known
  if (profiles.length >= MAX_REGISTERED_PROFILES)
    throw new RangeError(`at most ${MAX_REGISTERED_PROFILES} subsurface profiles`)
  profiles.push(profile)
  rows.set(key, profiles.length)
  revision++
  return profiles.length
}

/** The profiles collected, in the order of their rows (row 1 the first), and the number of the collection (it grows with each new one). */
export const registeredSubsurfaceProfiles = () => ({ profiles, revision })
