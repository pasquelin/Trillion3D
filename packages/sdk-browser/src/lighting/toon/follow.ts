import {
  resolveToonProfile,
  type ToonProfile,
} from '../../../../sdk-core/src/lighting/toonProfile/profile.ts'
import {
  TOON_ROWS_AT,
  packToonRow,
  toonLayout,
  toonPatternsAt,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { bakeToonPatterns, imageState, type ImageState, type ToonBakeSource } from './bake.ts'
import { toonTablesOf, type Held } from './buffer.ts'
import { registeredToonProfiles, toonImagesOf } from './registry.ts'

/** What a toon buffer holds of the toon profiles: the collection it was written for, the pattern slots its rows name, the stamp of the images baked, whether an image still loads, and the images with the version and the state of each that was seen. */
interface Written {
  revision: number
  slots: string
  baked: string
  loading: boolean
  images: readonly Texture[]
  versions: readonly number[]
  states: readonly ImageState[]
}
const written = new WeakMap<GPUBuffer, Written>()

const reported = new WeakSet<object>()
const reportFailedImage = (texture: { id: string }) => {
  if (reported.has(texture)) return
  reported.add(texture)
  console.warn(
    `Trillion3D: the toon profile image ${texture.id} failed to load; its profile is lit plainly.`,
  )
}

const DEFAULT_PROFILE = /* @__PURE__ */ resolveToonProfile({})

const imagesOf = (s: ToonBakeSource) => [s.diffuseOffset, s.specularOffset, s.hatching]

/** Whether an image of the profile is still loading (a failed one is settled for good, an absent one has nothing to wait for). */
const imagesLoading = (profile: ToonProfile) => {
  const source = toonImagesOf(profile)
  return !!source && imagesOf(source).some((t) => t && imageState(t) === 'loading')
}

/** The profile as the lights wear it: its images dropped while one of them is still loading or has failed to, so that it is lit plainly (a failed image is reported once). */
const wornProfile = (profile: ToonProfile): ToonProfile => {
  const source = toonImagesOf(profile)
  if (!source || imagesOf(source).every((t) => !t || imageState(t) === 'decoded')) return profile
  for (const t of imagesOf(source)) if (t && imageState(t) === 'failed') reportFailedImage(t)
  return {
    ...profile,
    diffuseRampOffsetTexture: null,
    specularRampOffsetTexture: null,
    shadowHatchingPatternTexture: null,
  }
}

/** The stamp of the images baked: each texture by its name and the number of its last write. */
const stampOf = (sources: readonly ToonBakeSource[]) =>
  sources
    .flatMap(imagesOf)
    .map((t) => (t ? `${t.id}:${t.version}` : '-'))
    .join()

/**
 * THE TOON PROFILES THE LIGHTS READ: at a frame's end of lights, the row of each profile the materials hold (`toonProfileRow`; row 0 the default
 * profile's, and a row nobody holds) written into the toon buffer (`toonTablesOf`, at the resolution `texels`, `packToonRow`) when the collection
 * changed since the buffer was written, and the images of the profiles that wear any baked into their pattern slots (`bakeToonPatterns`) when one is
 * new or written. A profile that wears images takes a slot (the registry admits as many as the buffer can hold). A profile with an image still loading
 * wears none (`wornProfile`) until all its images are decoded; a frame where nothing changed does no more than compare the images' versions. The image of the runtime (`run.frame`, its own image counter, whichever driver renders)
 * and the collection's revision it was followed at are kept on the buffer's record (`Held.followed`): the lights ask about twelve times an image, one follow serves them. The runtime records the texels it uses on the
 * buffer (`toonTablesOf`). Returns the buffer.
 */
export function followToonProfiles(device: GPUDevice, texels: number, run: { frame: number }) {
  const tables = toonTablesOf(device, texels, run),
    { followed } = tables,
    seen = followed.get(run),
    { revision } = registeredToonProfiles()
  // The lights ask about twelve times an image: the later asks read what the first followed, until a new image of this runtime or a new collection.
  if (!seen || seen.image !== run.frame || seen.revision !== revision) {
    writeProfiles(device, tables)
    followed.set(run, { image: run.frame, revision })
  }
  return tables.buffer
}

/** The rows and patterns of the profiles written into the buffer when the collection or an image changed since it was written. */
function writeProfiles(device: GPUDevice, { buffer, rows: rowCapacity, texels }: Held) {
  const { profiles, revision, users } = registeredToonProfiles()
  if (users === 0) return
  const state = written.get(buffer)
  if (
    state &&
    state.revision === revision &&
    !state.loading &&
    state.images.every(
      (t, i) => t.version === state.versions[i] && imageState(t) === state.states[i],
    )
  )
    return
  const layout = toonLayout(texels)
  const kept = state ?? {
    revision: -1,
    slots: '',
    baked: '',
    loading: false,
    images: [],
    versions: [],
    states: [],
  }
  const table = [DEFAULT_PROFILE, ...profiles.map((profile) => profile ?? DEFAULT_PROFILE)].map(
    wornProfile,
  )
  const sources: ToonBakeSource[] = []
  const sourceOf = table.map((profile) => {
    const source = toonImagesOf(profile)
    if (!source) return -1
    sources.push(source)
    return sources.length - 1
  })
  const baked = stampOf(sources)
  if (baked !== kept.baked && sources.length > 0) {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D toon profile bake' })
    if (
      bakeToonPatterns(
        device,
        encoder,
        buffer,
        toonPatternsAt(layout, rowCapacity),
        layout,
        sources,
      )
    ) {
      device.queue.submit([encoder.finish()])
      kept.baked = baked
    }
  }
  // A row names its pattern slot only once the bake of this stamp is done; until then it stays plain (-1).
  const slotOf = kept.baked === baked ? sourceOf : sourceOf.map(() => -1)
  const slots = slotOf.join()
  if (kept.revision !== revision || kept.slots !== slots) {
    const rows = new Uint32Array(table.length * layout.rowWords)
    table.forEach((profile, row) =>
      rows.set(packToonRow(profile, slotOf[row]!, layout), row * layout.rowWords),
    )
    device.queue.writeBuffer(buffer, TOON_ROWS_AT * 4, rows)
    kept.revision = revision
    kept.slots = slots
  }
  kept.loading = profiles.some((p) => p && imagesLoading(p))
  const images = sources.flatMap(imagesOf).filter((t) => t !== null)
  // An image not decoded is tracked too (failed, absent, or loading), at the version it had: a picture set on it later is seen and the profile worn again.
  const undecoded = profiles
    .flatMap((p) => {
      const source = p && toonImagesOf(p)
      return source ? imagesOf(source) : []
    })
    .filter((t): t is NonNullable<typeof t> => t !== null && imageState(t) !== 'decoded')
  kept.images = [...images, ...undecoded]
  // The state too: a source given to a picture element that had none (absent) or that failed changes its state without a new version.
  kept.states = kept.images.map(imageState)
  // A bake that did not run is tried again the next frame.
  kept.versions = [
    ...images.map((t) => (kept.baked === baked ? t.version : -1)),
    ...undecoded.map((t) => t.version),
  ]
  written.set(buffer, kept)
}
