import { retire } from '../../gpu/core/frameRetire.ts'
import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { VOLUMETRIC_LIGHT_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { volumetricLightmapLayoutEntries } from '../volumetricLightmap/textures.ts'
import type { VolumetricLightmapGpu } from '../volumetricLightmap/gpu.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { clearedColourTarget, fullscreenDescriptor, preparedPipeline } from './fullscreen.ts'
import { createPassGroup } from './passGroup.ts'
import {
  VOLUMETRIC_LIGHT_ENTRY,
  VOLUMETRIC_LIGHT_FIRST,
  VOLUMETRIC_LIGHT_FORMAT,
  VOLUMETRIC_LIGHT_WGSL,
} from './volumetricLightWgsl.ts'

/** `GPUShaderStage.FRAGMENT`, written in the clear: the layouts are also read from Node. */
const fragment = 2

/** The surface's layers and depth the pass reads, the view, and the lightmap's resources. */
const layoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(DEFERRED_BINDINGS.colours, 'unfilterable-float', '2d-array', fragment),
  computeTextureEntry(DEFERRED_BINDINGS.words, 'uint', '2d-array', fragment),
  computeTextureEntry(DEFERRED_BINDINGS.depth, 'depth', '2d', fragment),
  computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', fragment),
  ...volumetricLightmapLayoutEntries(VOLUMETRIC_LIGHT_FIRST, fragment),
]

/** The pass's pipeline, asked now, off the frame. */
function lightPipeline(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  failed: (error: unknown) => void,
) {
  const module = device.createShaderModule({
    label: VOLUMETRIC_LIGHT_PASS,
    code: wgslModule(VOLUMETRIC_LIGHT_WGSL),
  })
  const pipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      VOLUMETRIC_LIGHT_ENTRY,
      [{ format: VOLUMETRIC_LIGHT_FORMAT }],
      VOLUMETRIC_LIGHT_PASS,
    ),
  ).ask()
  pipeline.prepare().catch(failed)
  return pipeline
}

/** The texture the light is left in. */
function lightTarget(device: GPUDevice, width: number, height: number) {
  return device.createTexture({
    label: 'Trillion3D volumetric lightmap light',
    size: [width, height],
    format: VOLUMETRIC_LIGHT_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
}

/**
 * The pass that leaves the volumetric lightmap's light on the pixels (`VOLUMETRIC_LIGHT_WGSL`): its
 * pipeline asked now, off the frame, and the frames waiting for it (`preparedPipeline`); its target
 * made for the image's size, kept while the size holds and made again when it changes; its group made
 * again when a resource it names is replaced. A frame that finds the pipeline not compiled gets no
 * light from the lightmap. `view` is the lighting's view uniform.
 */
export function createVolumetricLightPass(
  device: GPUDevice,
  view: GPUBuffer,
  failed: (error: unknown) => void,
) {
  const layout = device.createBindGroupLayout({ entries: layoutEntries() })
  const pipeline = lightPipeline(device, layout, failed)
  const group = createPassGroup(device, layout)
  const { target: attachment, descriptor } = clearedColourTarget(VOLUMETRIC_LIGHT_PASS)
  /** What the group is made of, named again at each draw: allocates nothing. */
  const named: unknown[] = [undefined, undefined, undefined]
  let target: GPUTexture | undefined, targetView: GPUTextureView | undefined
  return {
    /** Whether the pipeline is compiled. */
    get ready() {
      return pipeline.ready
    },
    /** Leaves the light of `lightmap` on the `width` × `height` pixels of `surface` (seen from `depth`) and
     *  returns the texture it left it in, the indirect pass's. */
    draw(
      encoder: GPUCommandEncoder,
      surface: SurfaceBuffer,
      depth: GPUTextureView,
      lightmap: VolumetricLightmapGpu,
      width: number,
      height: number,
    ) {
      if (!target || target.width !== width || target.height !== height) {
        if (target) retire(device, target)
        target = lightTarget(device, width, height)
        targetView = target.createView()
      }
      const [colours, words] = surface.stores()
      named[0] = surface
      named[1] = depth
      named[2] = lightmap
      const bound = group.get(named, () => [
        ...namedEntries(DEFERRED_BINDINGS, { colours, words, depth, view: { buffer: view } }),
        ...lightmap.entries(VOLUMETRIC_LIGHT_FIRST),
      ])
      attachment.view = targetView!
      drawFullscreenTriangle(encoder, descriptor, pipeline.get(), bound, width, height)
      return targetView!
    },
    release() {
      group.release()
      target?.destroy()
      target = targetView = undefined
    },
  }
}
