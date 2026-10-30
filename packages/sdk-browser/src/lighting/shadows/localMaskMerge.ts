import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { perViewLayers, type LayerRoom } from '../../gpu/core/layerRoom.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../gpu/core/oncePerDevice.ts'
import { arrayView, layerView } from '../../gpu/core/textureViews.ts'
import { CAPSULE_BLENDS } from '../capsuleShadows/frame.ts'
import type { SelfShadowRect } from './firstPerson/selfShadowWindow.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'

/** The masks a local light's extra shadow is taken into: the one-pass projection's capsule layers (`r8unorm`) and the per-light path's masks (`rgba8unorm`). */
export type LocalMaskFormat = 'r8unorm' | 'rgba8unorm'

/** What one kind of extra shadow gives the merge: labels, the fragment module (made by the caller from its listed program) and its entry, and the binding of a surface flags texture (`uint`) the program reads beside the layer at binding 0, if any. */
export interface LocalMaskMergeSpec {
  label: string
  passLabel: string
  entry: string
  module: (device: GPUDevice) => GPUShaderModule
  flagsBinding?: number
}

/** The shadows of the local lights at the drawn size, a layer a light: the storage the kernel writes and a view of each layer the merge reads. */
export interface LocalMaskLayers extends LayerRoom {
  texture: GPUTexture
  storage: GPUTextureView
  layers: GPUTextureView[]
  /** The distances of the nearest blockers, a layer a light as well, where a denoiser asked for them. */
  hits?: { texture: GPUTexture; storage: GPUTextureView; layers: GPUTextureView[] }
}

/**
 * THE SHARED MERGE OF A LOCAL LIGHT'S EXTRA SHADOW (the first-person self shadow, the ray traced shadow): a texture of one layer a light at the drawn size
 * (`layersFor`, one a view and made for the most lights asked in the last `IDLE_KEEP_IMAGES` images so that runs of different counts do not remake it by turns, `release` lets a view's go) and the pass that takes a
 * layer into the light's mask (`merge`): the fragment program writes the square root of the shadow and the pipeline's blend (`CAPSULE_BLENDS.attenuation`)
 * keeps the minimum of that and what the mask holds, over a rectangle.
 */
export function localMaskMerge(spec: LocalMaskMergeSpec) {
  const shader = oncePerDevice((device: GPUDevice) => {
    const entries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ]
    if (spec.flagsBinding !== undefined)
      entries.push({
        binding: spec.flagsBinding,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint' },
      })
    return {
      layout: device.createBindGroupLayout({ label: spec.label, entries }),
      module: spec.module(device),
    }
  })
  const pipelineOf = oncePerDeviceKey((device: GPUDevice, format: LocalMaskFormat) => {
    const { layout, module } = shader(device)
    return preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        layout,
        spec.entry,
        [{ format, blend: CAPSULE_BLENDS.attenuation }],
        `${spec.label} ${format}`,
      ),
    ).ask()
  })
  /** The merge's bind group of each layer view (it goes with the layer), kept while the flags view it reads is the same. */
  const groups = new WeakMap<GPUTextureView, { flags?: GPUTextureView; bind: GPUBindGroup }>()
  const attachment: GPURenderPassColorAttachment = {
    view: undefined as never,
    loadOp: 'load',
    storeOp: 'store',
  }
  const passDescriptor: GPURenderPassDescriptor = {
    label: spec.passLabel,
    colorAttachments: [attachment],
  }

  const views = perViewLayers<LocalMaskLayers>((old) => {
    old.texture.destroy()
    old.hits?.texture.destroy()
  })
  const release = (gpu: { viewKey?: object }, replaced = false) =>
    views.release(viewKey(gpu), replaced)
  /** Image `frame` is over: the keeping window folds it where no `layersFor` did. */
  const keep = (gpu: { viewKey?: object }, frame: number) => views.keep(viewKey(gpu), frame)

  const layersOf = (
    device: GPUDevice,
    label: string,
    size: readonly [number, number],
    count: number,
  ) => {
    const texture = device.createTexture({
      label,
      size: [size[0], size[1], count],
      format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    return {
      texture,
      storage: arrayView(texture),
      layers: Array.from({ length: count }, (_, layer) => layerView(texture, layer)),
    }
  }

  /** The layers of the view `gpu` for `count` lights at `size`, with the distances of the blockers (`withHits`, kept while the window asks them and dropped when one ends without). They hold the most lights asked in the window of `IDLE_KEEP_IMAGES` images that ends at `frame`: where a window asked for fewer than they hold, they are made again at that. */
  function layersFor(
    gpu: WebgpuPagesRuntime['gpu'],
    device: GPUDevice,
    size: readonly [number, number],
    count: number,
    withHits = false,
    frame = 0,
  ) {
    return views.layers(
      viewKey(gpu),
      device,
      size.join('x'),
      count,
      frame,
      (room, hits) => ({
        ...layersOf(device, spec.label, size, room),
        ...(hits && { hits: layersOf(device, `${spec.label} hits`, size, room) }),
      }),
      (have, hits) => hits !== !!have.hits,
      withHits,
    )
  }

  /** Takes `layer` into the mask `target` (a view of `format`) over `rect`; `flags` is the surface flags view when the spec names its binding. */
  function merge(
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    format: LocalMaskFormat,
    target: GPUTextureView,
    layer: GPUTextureView,
    rect: SelfShadowRect,
    flags?: GPUTextureView,
  ) {
    const pipeline = pipelineOf(device, format).get()
    if (!pipeline) return
    let group = groups.get(layer)
    if (!group || group.flags !== flags) {
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: layer }]
      if (spec.flagsBinding !== undefined && flags)
        entries.push({ binding: spec.flagsBinding, resource: flags })
      group = { flags, bind: device.createBindGroup({ layout: shader(device).layout, entries }) }
      groups.set(layer, group)
    }
    attachment.view = target
    const pass = encoder.beginRenderPass(passDescriptor)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group.bind)
    pass.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
    pass.draw(3)
    pass.end()
  }

  return { release, keep, layersFor, merge }
}
