import { skyLightSource, type SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { SkyLightCubemap } from '../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import {
  cubemapPairFit,
  openSkyCubemap,
  writeSkyCubemapFaces,
  type SkyCubemapUpload,
} from '../../modules/sky/skyLight/cubemap.ts'
import { CUBE_FACES } from '../../modules/sky/skyLight/layout.ts'

/**
 * THE CUBES OF A SPECIFIED-CUBEMAP SKY LIGHT: the textures made of the part's cubemap and of the cube
 * it blends to (`SkyLightPart.cubemap`, `cubemapBlend`), kept while the picture is the same data and
 * the pair is rescaled alike, and retired when it is not, none where the light's source is not the
 * specified cubemap or the part holds no picture. A cube is written over the images, face by face
 * within a budget (`writeSkyCubemapFaces`), and handed to the light once whole.
 */
interface HeldCube extends SkyCubemapUpload {
  readonly data: SkyLightCubemap
}

/** What the engine holds of the light's cubes, and whether one is still being written. */
export interface SkyCubemaps {
  source?: HeldCube
  destination?: HeldCube
  pending?: boolean
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
  fit: ReturnType<typeof cubemapPairFit>,
) {
  let cube = held
  if (!(held && held.data.texels === data?.texels && held.fit.cube === fit.cube)) {
    if (held) retire(device, held.texture)
    cube = data && { data, ...openSkyCubemap(device, data, fit) }
  }
  if (cube && cube.written < CUBE_FACES) writeSkyCubemapFaces(device, cube, cube.data)
  return cube
}

/** Whether the cube is written whole: only then is it the light's. */
const whole = (cube: HeldCube | undefined) => cube?.written === CUBE_FACES

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
  const fit = cubemapPairFit(source, destinationData)
  held.source = cubeOf(device, held.source, source, fit)
  held.destination = cubeOf(device, held.destination, destinationData, fit)
  const { destination } = held
  held.pending = [held.source, destination].some((cube) => cube && !whole(cube))
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

/** Whether `a` and `b` give the light the same cubes and the same share. */
export const sameSkyCubes = (a: SkyCubes | undefined, b: SkyCubes) =>
  a?.cubemap === b.cubemap &&
  a?.blend?.destination === b.blend?.destination &&
  a?.blend?.fraction === b.blend?.fraction

/** The textures held are retired. */
export function releaseSkyCubemaps(device: GPUDevice | undefined, held: SkyCubemaps) {
  for (const cube of [held.source, held.destination])
    if (cube && device) retire(device, cube.texture)
  held.source = held.destination = undefined
  held.pending = false
}
