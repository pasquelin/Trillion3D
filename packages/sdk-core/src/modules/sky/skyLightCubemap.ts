import { isRecord, type Refuse } from '../../contracts/nameMatch.ts'

/**
 * THE SKY LIGHT'S CUBEMAP AS DATA, for a light whose source is a specified cubemap
 * (`skyLightSource`): the picture it lights the scene with, and the one it blends to. The form is
 * the fog's cubemap's: `size` texels across a face and `texels`, the six faces in the order `+x, −x,
 * +y, −y, +z, −z` of a cube texture looked up by the scene's own direction (+y up), each row by row
 * from its top-left corner, three linear numbers a texel — radiance, as much as the light holds. The
 * data is not copied: it must not be written after it is set. The engine makes the texture of it,
 * and keeps it while the data is the same.
 *
 * A blend (`SkyLightCubemapBlend`) mixes the source with a second cube by `fraction`, for a sky
 * lighting that moves between two times of the day: 0 is the source alone, 1 the destination alone,
 * a value beyond is held to them. A host that moves the fraction writes the part again.
 */
export interface SkyLightCubemap {
  /** Texels across one face, from 1 to `SKY_LIGHT_CUBEMAP_MAX_SIZE`. */
  readonly size: number
  /** The six faces, `6 · size² · 3` linear numbers ≥ 0. */
  readonly texels: ArrayLike<number>
}

/** The cube the light blends to, and the share of it. */
export interface SkyLightCubemapBlend {
  readonly destination: SkyLightCubemap
  readonly fraction: number
}

/** The most texels across a face: six faces of that size in 32-bit floats are about 75 MB. */
const SKY_LIGHT_CUBEMAP_MAX_SIZE = 1024

/** The fields of the part that carry the cubemaps, besides its settings. */
export const SKY_LIGHT_CUBEMAP_FIELDS = ['cubemap', 'cubemapBlend'] as const

/** The texels already checked: a picture that is written again with a blend's fraction is not read
 *  through again (its data must not be written after it is set). */
const checked = new WeakSet<object>()

/** A cubemap checked: a whole number of texels a face, the faces' numbers finite and ≥ 0. The texels
 *  are kept, not copied. */
export function resolveSkyLightCubemap(
  value: unknown,
  what: string,
  refuse: Refuse,
): SkyLightCubemap {
  if (!isRecord(value)) return refuse(`${what} must be an object of size, texels`)
  const { size, texels } = value
  if (
    !Number.isInteger(size) ||
    (size as number) < 1 ||
    (size as number) > SKY_LIGHT_CUBEMAP_MAX_SIZE
  )
    return refuse(`${what}.size must be a whole number from 1 to ${SKY_LIGHT_CUBEMAP_MAX_SIZE}`)
  const need = 6 * (size as number) ** 2 * 3
  const held = texels as ArrayLike<number> | undefined
  if (!held || held.length !== need)
    return refuse(`${what}.texels expects ${need} numbers, six faces of ${size}² texels`)
  if (!checked.has(held)) {
    for (let i = 0; i < need; i++)
      if (!Number.isFinite(held[i]) || held[i] < 0)
        return refuse(`${what}.texels expects finite numbers ≥ 0`)
    checked.add(held)
  }
  return { size: size as number, texels: held }
}

/** A blend checked: its destination a cubemap, its fraction a finite number. */
export function resolveSkyLightCubemapBlend(value: unknown, refuse: Refuse): SkyLightCubemapBlend {
  if (!isRecord(value)) return refuse('cubemapBlend must be an object of destination, fraction')
  const { destination, fraction } = value
  if (typeof fraction !== 'number' || !Number.isFinite(fraction))
    return refuse('cubemapBlend.fraction must be a finite number')
  return {
    destination: resolveSkyLightCubemap(destination, 'cubemapBlend.destination', refuse),
    fraction,
  }
}
