import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { perViewRuns } from '../../gpu/core/encoderUniforms.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { releaseDiffuseDenoise } from '../shadows/denoise/shadowDenoiseFrame.ts'
import type { SkyTable } from '../skyTable/skyTable.ts'
import { SKY_RAY_FLOATS, SKY_RAYS_SIDE } from './skyLightTracedWgsl.ts'
import { SKY_LIGHT_FORMAT, SKY_OPEN_FORMAT, SKY_PARAM_WORDS } from './skyLightTracedKit.ts'

/** What a view keeps of its ray-traced sky light, made for one size, one upscale and one ray count, made again where one moved. */
export interface SkyLightTracedView {
  readonly device: GPUDevice
  readonly key: string
  /** The grid the rays are cast over, one cell for `upscale` pixels a side. */
  readonly cells: readonly [number, number]
  readonly upscale: number
  readonly light: GPUTexture
  readonly lightView: GPUTextureView
  readonly open: GPUTexture
  readonly openView: GPUTextureView
  /** The directions of the decoupled generation (256 by 256 pixels, `samples` each), or the one record that stands in for them. */
  readonly rays: GPUBuffer
  /** The sky's table, made again at the cube's size, and the key of the cube it was last built from. */
  table?: SkyTable
  tableKey: string
  /** The full-resolution texture the denoiser writes the sky light's mean colour to, made at the first image that denoises (its history lives with the shadow denoiser's, under the view). */
  denoised?: { texture: GPUTexture; view: GPUTextureView }
  /** Whether the last image's light accumulates over the images, and the weight an image adds to a pixel's sample: how long a quiet view is drawn again (`skyLightTracedSettling`). */
  accumulates: boolean
  imageWeight: number
}

const views = new WeakMap<object, SkyLightTracedView>()

/** The view's resources as the last image made them, none where it made none. */
export const skyLightViewOf = (gpu: { viewKey?: object }) => views.get(viewKey(gpu))

/** The uniforms and the bind groups of the passes, a pool a view: the trace's parameters, the directions' and the composite's share one size. */
export const skyLightRuns = perViewRuns('Trillion3D sky light params', SKY_PARAM_WORDS * 4)

/** The view's resources for this size (the full-resolution target `width` by `height`), upscale and rays a pixel, made again where one moved (the old ones retired). */
export function skyLightTracedViewOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  upscale: number,
  samples: number,
  decoupled: boolean,
) {
  const key = [width, height, upscale, decoupled ? samples : 0].join('x')
  const held = views.get(viewKey(rt.gpu))
  if (held?.device === device && held.key === key) return held
  if (held) releaseSkyLightTraced(rt.gpu, held.device !== device)
  const cells = [ceilDiv(width, upscale), ceilDiv(height, upscale)] as const
  const texture = (label: string, format: GPUTextureFormat) =>
    device.createTexture({
      label: `Trillion3D sky light ${label}`,
      size: [cells[0], cells[1]],
      format,
      usage: loadOnlyUsage() | GPUTextureUsage.STORAGE_BINDING,
    })
  const light = texture('light', SKY_LIGHT_FORMAT)
  const open = texture('openness', SKY_OPEN_FORMAT)
  // The record that stands in for the directions where each pixel draws its own (the reference's dummy buffer, cleared: a new buffer holds zeros).
  const records = decoupled ? SKY_RAYS_SIDE * SKY_RAYS_SIDE * samples : 1
  const made: SkyLightTracedView = {
    device,
    key,
    cells,
    upscale,
    light,
    lightView: light.createView(),
    open,
    openView: open.createView(),
    rays: device.createBuffer({
      label: 'Trillion3D sky light directions',
      size: records * SKY_RAY_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE,
    }),
    tableKey: '',
    accumulates: false,
    imageWeight: samples,
  }
  views.set(viewKey(rt.gpu), made)
  return made
}

/** The texture the denoiser writes the view's sky light to, at `width` by `height` pixels, made at the first image that denoises. */
export function skyLightDenoisedOf(
  view: SkyLightTracedView,
  width: number,
  height: number,
): GPUTextureView {
  if (!view.denoised) {
    const texture = view.device.createTexture({
      label: 'Trillion3D sky light denoised',
      size: [width, height],
      format: SKY_LIGHT_FORMAT,
      usage: loadOnlyUsage() | GPUTextureUsage.STORAGE_BINDING,
    })
    view.denoised = { texture, view: texture.createView() }
  }
  return view.denoised.view
}

/** The denoiser's output and history let go (the image draws the rays' light raw). */
export function releaseSkyLightDenoise(gpu: { viewKey?: object }, view: SkyLightTracedView) {
  releaseDiffuseDenoise(gpu)
  if (!view.denoised) return
  const { texture } = view.denoised
  retire(view.device, { destroy: () => texture.destroy() })
  view.denoised = undefined
}

/** A view's ray-traced sky light let go (the image lights the sky another way, or the device moved): its textures, directions, table, denoiser history and uniforms retired. */
export function releaseSkyLightTraced(gpu: { viewKey?: object }, replaced = false) {
  const key = viewKey(gpu)
  const held = views.get(key)
  if (!held) return
  releaseSkyLightDenoise(gpu, held)
  retire(
    held.device,
    {
      destroy() {
        held.light.destroy()
        held.open.destroy()
        held.rays.destroy()
        held.table?.destroy()
      },
    },
    replaced,
  )
  views.delete(key)
  skyLightRuns.release(key, replaced)
}
