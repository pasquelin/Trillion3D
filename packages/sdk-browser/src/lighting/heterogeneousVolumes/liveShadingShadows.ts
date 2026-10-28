import { encodePack, packedWordsOf, packResourcesOf } from './beerShadowMapPack.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import {
  boundingSphere,
  HV_SHADOW_BYTES,
  shadowLightsOf,
  writeShadowUniforms,
  type BeerBind,
} from './beerShadowMapGpu.ts'
import { bufferOf, stepImage, type State } from './liveShadingState.ts'

/** What one image holds for the maps of the volumes' shadows: the lights that have one, the size of their faces, how to reach the
 *  uniform and the images of a light, the count of volumes built into each, and the binding of a pass that builds none. The
 *  uniforms are written here (`placed` is given in the `shadows` phase only). */
export function shadowSetup(
  held: State,
  device: GPUDevice,
  rt: WebgpuPagesRuntime,
  placed:
    | readonly {
        toWorld: ArrayLike<number>
        centre: readonly number[]
        extent: readonly number[]
      }[]
    | undefined,
  settings: (field: HeterogeneousVolumeField) => number,
  beerFormat: GPUTextureFormat,
) {
  const resolution = settings('heterogeneousVolumesShadowsResolution')
  const lights = placed ? shadowLightsOf(rt.lights.store) : []
  const uniformOf = (rank: number) =>
    bufferOf(
      held,
      device,
      `beer map ${rank}`,
      HV_SHADOW_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    )
  const imageOf = (key: string, size: readonly [number, number]) =>
    stepImage(held, device, key, size, beerFormat)
  if (placed)
    writeShadowUniforms(device, lights, uniformOf, {
      resolution,
      sphere: boundingSphere(placed),
      near: settings('heterogeneousVolumesShadowsNearClippingDistance'),
      precision: settings('heterogeneousVolumesShadowsPrecision'),
    })
  const stand: BeerBind = {
    uniform: bufferOf(held, device, 'beer map stand-in', HV_SHADOW_BYTES, GPUBufferUsage.UNIFORM),
    previous: held.standBeer!.createView(),
    out: held.standBeerOut!.createView(),
  }
  const jobOf = (rank: number) =>
    bufferOf(
      held,
      device,
      `beer map pack ${rank}`,
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
  return { lights, resolution, uniformOf, imageOf, jobOf, built: new Map<number, number>(), stand }
}

/** Packs the maps the image built into the buffer the lit passes read (`heterogeneousShadowBufferOf`); none left where there are none. */
export function packShadowMaps(
  held: State,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  precision: number,
  jobOf: (rank: number) => GPUBuffer,
) {
  if (!held.maps.length) {
    held.packedMaps = undefined
    return
  }
  held.pack ??= packResourcesOf(device)
  held.packedMaps = bufferOf(
    held,
    device,
    'beer maps packed',
    packedWordsOf(held.maps, precision) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )
  encodePack({
    device,
    encoder,
    resources: held.pack,
    packed: held.packedMaps,
    maps: held.maps,
    precision,
    jobOf,
  })
}
