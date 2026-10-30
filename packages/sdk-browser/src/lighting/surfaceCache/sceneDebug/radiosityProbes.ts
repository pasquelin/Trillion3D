import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { PAGE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { DEPTH_CLEAR, DEPTH_COMPARE_OR_EQUAL } from '../../../camera/depthConvention.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createCachedGroup } from '../../../gpu/bind/cachedGroup.ts'
import { computeBufferEntry, computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { dispatchGrid, groupWidth, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { cachedLightingPreExposureOf } from '../../../post/exposure/frame.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { toneReadEntries } from '../../toneLutRead.ts'
import { createKernel } from '../kernel.ts'
import { shapeOf } from '../lighting/params.ts'
import { RADIANCE_PROBE_VERTICES } from './radianceProbesWgsl.ts'
import {
  RADIOSITY_PROBES_DRAW_BINDINGS as D,
  RADIOSITY_PROBES_DRAW_WORDS,
  RADIOSITY_PROBES_LIST_BINDINGS as L,
  RADIOSITY_PROBES_LIST_ENTRY,
  radiosityProbesDrawWgsl,
  radiosityProbesListWgsl,
} from './radiosityProbesWgsl.ts'
import type { SceneDebug } from './views.ts'
import { visualizeTonemapBindings } from './visualizeTonemap.ts'

/**
 * THE SPHERES AT THE RADIOSITY'S PROBES over the display image (`radiosityProbesWgsl.ts`): the listing of the probes of every page, then the draw of a sphere at each, coloured by the
 * light its harmonics give along the sphere's normal, over the display image and behind the surfaces (against the opaque depth, and against each other in a depth of its own).
 */

const LABEL = 'Trillion3D debug radiosity probes'
const DEPTH_FORMAT = 'depth32float'
const ro = 'read-only-storage' as const

/** The listing's kernel for a device. */
const listingOf = oncePerDevice((device: GPUDevice) =>
  createKernel(
    device,
    'radiosity probes',
    radiosityProbesListWgsl,
    [RADIOSITY_PROBES_LIST_ENTRY],
    [
      computeBufferEntry(L.tables, ro),
      computeTextureEntry(L.depth, 'uint'),
      computeTextureEntry(L.normal, 'float'),
      computeBufferEntry(L.args, 'storage'),
      computeBufferEntry(L.list, 'storage'),
      computeBufferEntry(L.view, 'uniform'),
    ],
  ),
)

/** The draw's layout and pipeline for a device. */
const drawOf = oncePerDevice((device: GPUDevice) => {
  const vertexFragment = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeBufferEntry(D.draw, 'uniform', vertexFragment),
      computeBufferEntry(D.list, ro, GPUShaderStage.VERTEX),
      computeTextureEntry(D.harmonics, 'float', '2d-array', GPUShaderStage.FRAGMENT),
      computeTextureEntry(D.depth, 'depth', '2d', GPUShaderStage.FRAGMENT),
      computeBufferEntry(D.tone, 'uniform', GPUShaderStage.FRAGMENT),
      ...toneReadEntries(D.tone + 1, GPUShaderStage.FRAGMENT),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: radiosityProbesDrawWgsl })
  return {
    layout,
    draw: preparedPipeline(device, {
      label: LABEL,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'radiosityProbeVs' },
      fragment: { module, entryPoint: 'radiosityProbeFs', targets: [{ format: DISPLAY_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE_OR_EQUAL,
      },
    }).ask(),
  }
})

/** What the spheres keep between images: the probes listed, the arguments of the draw, the uniform and the depth the spheres are tested against each other in. */
export function createRadiosityProbes(device: GPUDevice) {
  const uniform = uniformBlock(device, `${LABEL} uniform`, RADIOSITY_PROBES_DRAW_WORDS * 4)
  const { f: words, u: uints } = uniform.words
  // The arguments: the vertices of a cube, which nothing changes, then the instance count the listing adds to and each image clears.
  const args = device.createBuffer({
    label: `${LABEL} arguments`,
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  new Uint32Array(args.getMappedRange())[0] = RADIANCE_PROBE_VERTICES
  args.unmap()
  const drawGroup = createCachedGroup()
  let list: GPUBuffer | undefined
  let depth: { texture: GPUTexture; view: GPUTextureView } | undefined
  const listOf = (probes: number) => {
    if (list?.size !== probes * 16) {
      list?.destroy()
      list = device.createBuffer({
        label: `${LABEL} list`,
        size: probes * 16,
        usage: GPUBufferUsage.STORAGE,
      })
    }
    return list
  }
  const depthOf = (size: readonly [number, number]) => {
    if (depth?.texture.width !== size[0] || depth.texture.height !== size[1]) {
      depth?.texture.destroy()
      const texture = device.createTexture({
        label: `${LABEL} depth`,
        size,
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      depth = { texture, view: texture.createView() }
    }
    return depth.view
  }
  return {
    /** Draws the spheres `view` asks over `target` (`size` display pixels) seen through `viewProjection`; whether it did. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      viewProjection: ArrayLike<number>,
      view: SceneDebug,
    ) {
      const surface = rt.surfaceCache
      const resources = surface?.lighting?.resources
      const atlases = surface?.atlases
      const sceneDepth = rt.gpu.depthView
      const deferred = rt.gpu.deferred
      const tone = visualizeTonemapBindings(rt)
      // Nothing is drawn before the final lighting has been written once.
      if (!surface?.settings.surfaceCacheRadiosity || !resources || !atlases || !sceneDepth)
        return false
      if (!surface.lighting?.begun) return false
      if (!deferred || !tone || !surface.tables.buffer || !surface.cache.pages.length) return false
      const listing = listingOf(device)
      const draw = drawOf(device).draw.get()
      if (!listing.ready || !draw) return false
      const { spacing } = shapeOf(surface.settings, atlases.side, atlases.compressed, atlases.light)
      const perPage = PAGE_SIZE / spacing
      const probes = Math.min(
        (atlases.side / spacing) ** 2,
        Math.floor(device.limits.maxStorageBufferBindingSize / 16),
      )
      const probeList = listOf(probes)
      // The instance count and the words after it are cleared: no instance yet.
      encoder.clearBuffer(args, 4)
      words.set(viewProjection, 0)
      // The radius is in centimetres, the spheres' unit is the metre.
      words[16] = view.radiosityProbeRadius / DISTANCE_FIELD_UNITS_PER_METRE
      uints[17] = view.radiosityProbesShowInvalid ? 1 : 0
      words[18] = 1 / cachedLightingPreExposureOf(rt)
      words[19] = 0
      words[20] = size[0]
      words[21] = size[1]
      uniform.send()
      const pass = encoder.beginComputePass({ label: LABEL })
      pass.setPipeline(listing.pipeline(RADIOSITY_PROBES_LIST_ENTRY))
      pass.setBindGroup(
        0,
        listing.group(
          [
            resources.params,
            surface.tables.buffer,
            atlases.physical.depth,
            atlases.physical.normal,
            args,
            probeList,
            deferred.uniform,
          ],
          () => [
            { binding: 0, resource: { buffer: resources.params } },
            { binding: L.tables, resource: { buffer: surface.tables.buffer! } },
            { binding: L.depth, resource: atlases.physical.depth },
            { binding: L.normal, resource: atlases.physical.normal },
            { binding: L.args, resource: { buffer: args } },
            { binding: L.list, resource: { buffer: probeList } },
            { binding: L.view, resource: { buffer: deferred.uniform } },
          ],
        ),
      )
      const [x, y] = dispatchGrid(
        ceilDiv(surface.cache.pages.length * perPage * perPage, WORKGROUP_THREADS),
        groupWidth(device.limits),
      )
      pass.dispatchWorkgroups(x, y)
      pass.end()
      const render = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: depthOf(size),
          depthClearValue: DEPTH_CLEAR,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      })
      render.setPipeline(draw)
      // The tone's buffers are named by the buffer they wrap, which a new image does not change.
      const toneHeld = tone.resources.map((resource) =>
        'buffer' in resource ? resource.buffer : resource,
      )
      render.setBindGroup(
        0,
        drawGroup(
          device,
          drawOf(device).layout,
          [uniform.buffer, probeList, resources.harmonics, sceneDepth, ...toneHeld],
          () => [
            { binding: D.draw, resource: { buffer: uniform.buffer } },
            { binding: D.list, resource: { buffer: probeList } },
            { binding: D.harmonics, resource: resources.harmonics },
            { binding: D.depth, resource: sceneDepth },
            ...tone.resources.map((resource, at) => ({ binding: D.tone + at, resource })),
          ],
          LABEL,
        ),
      )
      render.drawIndirect(args, 0)
      render.end()
      return true
    },
    dispose() {
      uniform.buffer.destroy()
      args.destroy()
      list?.destroy()
      depth?.texture.destroy()
    },
  }
}

/** The spheres at the radiosity probes (`createRadiosityProbes`). */
export type RadiosityProbes = ReturnType<typeof createRadiosityProbes>
