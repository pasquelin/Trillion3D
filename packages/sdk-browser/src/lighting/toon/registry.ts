import {
  resolveToonProfile,
  type ToonProfile,
  type ToonProfileInput,
} from '../../../../sdk-core/src/lighting/toonProfile/profile.ts'
import {
  TOON_PATTERN_SLOTS,
  TOON_PROFILE_ROWS,
  toonShadowExtinction,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import type { ToonBakeSource } from './bake.ts'

/** The most profiles the table holds beside the default profile's row 0. */
const MAX_REGISTERED_PROFILES = TOON_PROFILE_ROWS - 1

/** A profile of the table: its row, how many materials hold it, its key. */
interface Held {
  profile: ToonProfile
  row: number
  count: number
  key: string
}

/** The table's rows, row 1 first: a profile, or nothing where its last material let it go (the row waits to be taken again). */
const profiles: (ToonProfile | undefined)[] = []
const held = new Map<string, Held>()
/** The held profiles by their row. */
const heldByRow = new Map<number, Held>()
const freeRows: number[] = []
/** The row each owner (a material's record) holds, and the hook that gives it back. */
const owned = new WeakMap<object, { row: number; hook: () => void; toon: boolean }>()
/** The toon records that hold the tables: the toon tables exist while there is one, with no profile named (the default profile's row) or several. */
let users = 0
let revision = 0
let imageProfiles = 0

/** The images a profile wears, or none. */
export const toonImagesOf = (profile: ToonProfile): ToonBakeSource | undefined => {
  const source = {
    diffuseOffset: profile.diffuseRampOffsetTexture,
    specularOffset: profile.specularRampOffsetTexture,
    hatching: profile.shadowHatchingPatternTexture,
  }
  return source.diffuseOffset || source.specularOffset || source.hatching ? source : undefined
}

/** The key of a profile: its fields, a texture by its name. */
const keyOf = (profile: ToonProfile) =>
  JSON.stringify(profile, (_, value) =>
    value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture
      ? (value as { id: string }).id
      : value,
  )

/**
 * THE TOON PROFILES THE MATERIALS NAME, counted as the materials hold them: the row of the toon table a material's `toonProfile`
 * takes — 0, the default profile, for none; else a row from 1, the same row for the same profile (its fields as the default profile
 * completes them, `resolveToonProfile`, its images the same textures). A row is held until `releaseToonProfile` gives it back as many
 * times as it was taken; then it is free for the next profile. Throws past 255 profiles held, or past 16 that wear images (the
 * pattern slots the toon buffer holds). A caller that never gives a row back (`toonProfileRow`) keeps it for good.
 */
export function toonProfileRow(input: ToonProfileInput | null | undefined) {
  if (!input) return 0
  const profile = resolveToonProfile(input)
  const key = keyOf(profile)
  const known = held.get(key)
  if (known) {
    known.count++
    return known.row
  }
  if (held.size >= MAX_REGISTERED_PROFILES)
    throw new RangeError(`at most ${MAX_REGISTERED_PROFILES} toon profiles`)
  if (toonImagesOf(profile)) {
    if (imageProfiles === TOON_PATTERN_SLOTS)
      throw new RangeError(`at most ${TOON_PATTERN_SLOTS} toon profiles wear images`)
    imageProfiles++
  }
  const row = freeRows.pop() ?? profiles.length + 1
  profiles[row - 1] = profile
  const entry = { profile, row, count: 1, key }
  held.set(key, entry)
  heldByRow.set(row, entry)
  revision++
  return row
}

/** Gives back one hold of `row` (0, the default profile, is never held); the last hold frees the row, and the table shrinks past its last held row. */
export function releaseToonProfile(row: number) {
  const entry = heldByRow.get(row)
  if (!entry || --entry.count > 0) return
  held.delete(entry.key)
  heldByRow.delete(row)
  if (toonImagesOf(entry.profile)) imageProfiles--
  profiles[row - 1] = undefined
  freeRows.push(row)
  while (profiles.length > 0 && profiles[profiles.length - 1] === undefined) {
    const last = profiles.length
    profiles.pop()
    freeRows.splice(freeRows.indexOf(last), 1)
  }
  revision++
}

/**
 * The row `input` takes for `owner`, a material's record, which is a toon one (`toon`) or not: the row it held before is given back, and the hook that
 * gives the last one back when the record is disposed is set once. A toon record counts as a user of the toon tables, whatever its row: the default
 * profile's, 0, takes none. 0 for a record that is not toon (one that never was holds nothing).
 */
export function holdToonProfile(
  owner: { released: Set<() => void> },
  input: ToonProfileInput | null | undefined,
  toon: boolean,
) {
  const before = owned.get(owner)
  if (!before && !toon) return 0
  const row = toon ? toonProfileRow(input) : 0
  // The new hold is counted before the old one is given back, so that a record that stays toon never drops the users to none.
  if (toon && users++ === 0) revision++
  if (before) letGo(before)
  const hook =
    before?.hook ??
    (() => {
      letGo(owned.get(owner)!)
      owned.delete(owner)
    })
  owned.set(owner, { row, hook, toon })
  owner.released.add(hook)
  return row
}

/** Gives back what a record held: its row, and its place among the users of the toon tables. */
function letGo({ row, toon }: { row: number; toon: boolean }) {
  releaseToonProfile(row)
  if (toon && --users === 0) revision++
}

const extinctions = new Float32Array(TOON_PROFILE_ROWS)
let extinctionsRevision = -1
const DEFAULT_EXTINCTION = /* @__PURE__ */ toonShadowExtinction(resolveToonProfile({}))

/**
 * The shadow extinction per centimetre of each profile row (the default profile's for a row nobody holds), what the shadow maps let a toon
 * pixel's light through by; none while no material is toon. The same array until the collection changes.
 */
export function toonShadowExtinctions() {
  if (users === 0) return undefined
  if (extinctionsRevision !== revision) {
    extinctions.fill(DEFAULT_EXTINCTION)
    profiles.forEach((profile, i) => {
      if (profile) extinctions[i + 1] = toonShadowExtinction(profile)
    })
    extinctionsRevision = revision
  }
  return extinctions
}

/** The profiles held, in the order of their rows (row 1 the first; `undefined` for a row nobody holds), and the number of the collection (it grows with each change). */
export const registeredToonProfiles = () => ({ profiles, revision, users })
