import { checkSidecarHead } from '../../../../sdk-core/src/contracts/sidecarSection.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'

/** Texels along a side of a profile's texture: the atlas's slice is as wide. */
export const PROFILE_SIDE = 256

/** The magic of a profile file, `T3IE` read as a little-endian word, and the version read. */
const MAGIC = 0x4549_3354

const VERSION = 1

/** Bytes of the five words before the texels: magic, version, width, height, brightness (the light's `iesBrightness` carries it; not read here). */
const HEADER_BYTES = 20

/** The half-float's sign bit, the bits below it, and the bits of infinity: a magnitude above it is not a number. */
const HALF_SIGN = 0x8000

const HALF_MAGNITUDE = 0x7fff

const HALF_INFINITY = 0x7c00

/** A light profile as its file holds it: the share of the measured light's greatest candela each direction gives (a texel that was not a number or was negative read as 0), as half-floats, `PROFILE_SIDE` texels a row, a row for each
 *  horizontal angle and a column for each vertical one. */
export interface LightProfileData {
  readonly texels: Uint16Array<ArrayBuffer>
}

const refused = (why: string) =>
  new EngineError('INVALID_SCENE_LIGHT', `light profile file: ${why}`, { why })

/** The names the compiler gives a profile's file: the head of its fingerprint. Anything else a
 *  lights file names is not fetched. */
const COMPILED_NAME = /^light-profile-[0-9a-f]{16}\.bin$/

/**
 * Reads the bytes of a profile file (`light_profile/format.rs`, written by the compiler). A file of
 * another magic, version or size is refused, never reinterpreted.
 */
export function decodeLightProfile(bytes: ArrayBuffer | ArrayBufferView): LightProfileData {
  const raw =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  checkSidecarHead(raw, {
    magic: MAGIC,
    version: VERSION,
    headBytes: HEADER_BYTES,
    what: 'light profile',
  })
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  if (view.getUint32(8, true) !== PROFILE_SIDE || view.getUint32(12, true) !== PROFILE_SIDE)
    throw refused('another size')
  const count = PROFILE_SIDE * PROFILE_SIDE
  if (view.byteLength !== HEADER_BYTES + 2 * count) throw refused('its texels are cut')
  const texels = new Uint16Array(count)
  for (let i = 0; i < count; i++) {
    const bits = view.getUint16(HEADER_BYTES + 2 * i, true)
    // A texel that is NaN or below 0 (its sign bit set) is 0, as the atlas takes the texels in.
    texels[i] = bits & HALF_SIGN || (bits & HALF_MAGNITUDE) > HALF_INFINITY ? 0 : bits
  }
  return { texels }
}

/** Whether `id` names a profile file of the compiler. */
export const isCompiledProfile = (id: string) => COMPILED_NAME.test(id)

/** The address of the profile file `id`, beside the cache's manifest at `base`. */
export const lightProfileUrl = (base: string, id: string) => new URL(id, base).href
