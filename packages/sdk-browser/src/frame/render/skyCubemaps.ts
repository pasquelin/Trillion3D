import { skyLightSource, type SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { SkyLightCubemap } from '../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import {
  convertSkyCubemap,
  cubemapPairFit,
  followMeasured,
  openSkyCubemap,
  writeSkyCubemapFaces,
  type SkyCubemapUpload,
} from '../../modules/sky/skyLight/cubemap.ts'
import { prepareCubeHalf } from '../../modules/sky/skyLight/cubeHalf.ts'
import { CUBE_FACES } from '../../modules/sky/skyLight/layout.ts'

/**
 * THE CUBES OF A SPECIFIED-CUBEMAP SKY LIGHT: the textures made of the part's cubemap and of the cube
 * it blends to (`SkyLightPart.cubemap`, `cubemapBlend`), kept while the picture is the same data and
 * the pair is rescaled alike, and retired when it is not, none where the light's source is not the
 * specified cubemap or the part holds no picture. A cube is made on the GPU from the float cube its peak was found over in one dispatch
 * (`convertSkyCubemap`), or, where that cube is gone, written over the images face by face within a budget (`writeSkyCubemapFaces`),
 * and handed to the light once whole. The rescale needs the pair's brightest channel, found on the GPU over a few images: until it is
 * back the cubes already held are kept as they were handed, with their share (`handed`), the image is drawn again (`pending`).
 */
interface HeldCube extends SkyCubemapUpload {
  readonly data: SkyLightCubemap
}

/** What the engine holds of the light's cubes, and whether one is still being written. */
export interface SkyCubemaps {
  source?: HeldCube
  destination?: HeldCube
  pending?: boolean
  /** What the light was last handed, kept whole while the new pair is not ready. */
  handed?: SkyCubes
  /** The cubes whose brightest channel the GPU is being asked for (`cubemapPairFit`). */
  measuring?: readonly SkyLightCubemap[]
}

/** The cube the light reads the source from and its light scale, and the cube it blends to with the
 *  share of it and its own scale (`SkyLightSource.cubemap`, `cubemapScale`, `blend`). */
export interface SkyCubes {
  readonly cubemap?: GPUTexture
  readonly cubemapScale?: number
  readonly blend?: {
    readonly destination: GPUTexture
    readonly fraction: number
    readonly scale: number
  }
}

/** The cube of `data`: the held one where it is the same picture rescaled the same, made again, the
 *  old one retired, where it is not; none for no picture. Its next faces are written. */
function cubeOf(
  device: GPUDevice,
  held: HeldCube | undefined,
  data: SkyLightCubemap | undefined,
  fit: NonNullable<ReturnType<typeof cubemapPairFit>>,
) {
  let cube = held
  if (!(held && held.data.texels === data?.texels && held.fit.cube === fit.cube)) {
    if (held) retire(device, held.texture)
    cube = data && { data, ...openSkyCubemap(device, data, fit) }
  }
  if (cube && cube.written === 0) convertSkyCubemap(device, cube, cube.data)
  if (cube && cube.written < CUBE_FACES) writeSkyCubemapFaces(device, cube, cube.data)
  return cube
}

/** Whether the cube is written whole: only then is it the light's. */
const whole = (cube: HeldCube | undefined) => cube?.written === CUBE_FACES

/** What the light is handed of the cubes held: the source once whole, and the destination once whole with its share. */
function cubesOf(held: SkyCubemaps, part: SkyLightPart | undefined): SkyCubes {
  const { destination } = held
  return {
    cubemap: whole(held.source) ? held.source?.texture : undefined,
    cubemapScale: held.source?.scale,
    blend:
      destination && whole(destination) && part?.cubemapBlend
        ? {
            destination: destination.texture,
            fraction: part.cubemapBlend.fraction,
            scale: destination.scale,
          }
        : undefined,
  }
}

/** The light's cubes of this image: the textures of the part's pictures where its source is a
 *  specified cubemap, both rescaled by the brighter of the two (one scale for the pair). */
export function followSkyCubemaps(
  device: GPUDevice,
  held: SkyCubemaps,
  part: SkyLightPart | undefined,
): SkyCubes {
  const specified = !!part && skyLightSource(part) === 'specifiedCubemap'
  const source = specified ? part.cubemap : undefined
  const destinationData = specified ? part.cubemapBlend?.destination : undefined
  const wanted = [source, destinationData].filter((cube) => cube !== undefined)
  held.measuring = followMeasured(device, held, held.measuring, wanted)
  if (wanted.length > 0) prepareCubeHalf(device)
  // A cube not held yet keeps its float cube on the GPU until it is converted from it.
  const unconverted = ({ texels }: SkyLightCubemap) =>
    ![held.source, held.destination].some((cube) => cube?.data.texels === texels)
  const fit = cubemapPairFit(device, held, unconverted, source, destinationData)
  if (!fit) {
    held.pending = true
    return (held.handed ??= cubesOf(held, part))
  }
  held.source = cubeOf(device, held.source, source, fit)
  held.destination = cubeOf(device, held.destination, destinationData, fit)
  held.pending = [held.source, held.destination].some((cube) => cube && !whole(cube))
  return (held.handed = cubesOf(held, part))
}

/** Whether `a` and `b` give the light the same cubes and the same share. */
export const sameSkyCubes = (a: SkyCubes | undefined, b: SkyCubes) =>
  a?.cubemap === b.cubemap &&
  a?.blend?.destination === b.blend?.destination &&
  a?.blend?.fraction === b.blend?.fraction

/** The textures held are retired. */
export function releaseSkyCubemaps(device: GPUDevice | undefined, held: SkyCubemaps) {
  for (const cube of [held.source, held.destination])
    if (cube && device) retire(device, cube.texture)
  held.source = held.destination = held.handed = undefined
  held.measuring = device ? followMeasured(device, held, held.measuring, []) : []
  held.pending = false
}
