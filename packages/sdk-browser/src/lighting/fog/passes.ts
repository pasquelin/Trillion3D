import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { FOG_VOLUME_PASS } from '../../diagnostic/stage/passLabels.ts'
import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import { FOG_BINDING } from './programs.ts'
import type { FogGrid } from './layout.ts'
import type { FogVolumeResources, VolumeTextures } from './resources.ts'

/** What one image gives the volume's passes: the scene's depth and, where this image built the depth
 *  pyramid's farthest layer of the finished opaque depth before the volume (after the raster's rest
 *  pass and the transparents' front pass: `opaquePyramidOf`), its resources (`GpuHiz.depth`) — the
 *  furthest depth is read from them; without, no cell is held hidden —, the light buffer and its
 *  light lists, the virtual shadow maps the sun's shadow reads (the very ones a blended surface
 *  binds), and the fog's cubemap, none where it has none. */
export interface FogPassInputs {
  depth: GPUTextureView
  hiz?: HizDepth
  lights: GPUBuffer
  tiles: GPUBuffer
  vsm: {
    pageTable: GPUBuffer
    projectionData: GPUBuffer
    uniforms: GPUBuffer
    pool: GPUBuffer
    view: GPUBuffer
  }
  cubemap?: GPUTextureView
}

/** One program's bind groups: what they name (`WebgpuBindIdentity`, two held, the images taking
 *  turns), and the group made for each identity held, by its slot. */
interface ProgramGroups {
  identity: WebgpuBindIdentity
  groups: (GPUBindGroup | undefined)[]
}

/** The bind groups of the three programs, made again only where a resource they name was replaced:
 *  nothing is allocated in an image whose resources are those of two images before. */
export function createFogGroups() {
  const program = (): ProgramGroups => ({ identity: createWebgpuBindIdentity(2), groups: [] })
  return { furthest: program(), scatter: program(), integrate: program() }
}

/** The groups of the volume's programs (`createFogGroups`). */
export type FogGroups = ReturnType<typeof createFogGroups>

/** What the passes of an image are made over: the device, the resources, the groups, the stand-in
 *  cubemap, which of the two scatter volumes this image writes and the cells the view uses of the
 *  textures (the threads dispatched: the textures may hold more). */
export interface FogPassContext {
  device: GPUDevice
  resources: FogVolumeResources
  groups: FogGroups
  whiteCubemap: GPUTextureView
  ping: number
  cells: FogGrid
}

/** Groups of `size` threads that cover `n` cells. */
const threads = (n: number, size: number) => ceilDiv(n, size)

/** The group held for the identity just named (`next`), none where it moved: the group then held at
 *  its slot was made for another. */
function heldGroup({ identity, groups }: ProgramGroups) {
  if (identity.moved()) groups[identity.slot] = undefined
  return groups[identity.slot]
}

/** A group made for the identity just named, kept at its slot. */
function keptGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  { identity, groups }: ProgramGroups,
  entries: GPUBindGroupEntry[],
) {
  return (groups[identity.slot] = device.createBindGroup({
    label: 'Trillion3D fog',
    layout,
    entries,
  }))
}

/** The entries of the furthest depth's group: the frame, the pyramid, the plane written. */
function furthestEntries(resources: FogVolumeResources, hiz: HizDepth, plane: GPUTextureView) {
  return [
    ...namedEntries(FOG_BINDING, {
      frame: { buffer: resources.frame.buffer },
      furthestOut: plane,
    }),
    ...hizDepthBindEntries(FOG_BINDING.hiz, hiz),
  ]
}

/** The entries of the scatter's group: the light buffer and its lists, the depth, the furthest depth
 *  of this image and of the one before, the volume before and the one written, the cubemap and the
 *  shadow maps. */
function scatterEntries(
  { resources, ping, whiteCubemap }: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
) {
  const { vsm } = input
  const planes = textures.furthest
  return namedEntries(FOG_BINDING, {
    lights: { buffer: input.lights },
    tiles: { buffer: input.tiles },
    frame: { buffer: resources.frame.buffer },
    depth: input.depth,
    furthest: planes[ping].view,
    previousFurthest: planes[1 - ping].view,
    previousVolume: textures.scattering[1 - ping].view,
    sampler: resources.sampler,
    scattering: textures.scattering[ping].view,
    cubemap: input.cubemap ?? whiteCubemap,
    pageTable: { buffer: vsm.pageTable },
    projectionData: { buffer: vsm.projectionData },
    shadowUniforms: { buffer: vsm.uniforms },
    shadowPool: { buffer: vsm.pool },
    shadowView: { buffer: vsm.view },
  })
}

/** The entries of the integration's group: the frame, the scatter read, the volume written. */
function integrateEntries(
  resources: FogVolumeResources,
  scatterIn: GPUTextureView,
  integrated: GPUTextureView,
) {
  return namedEntries(FOG_BINDING, {
    frame: { buffer: resources.frame.buffer },
    scatterIn,
    integrated,
  })
}

/** The furthest depth of the cells across the image, from the depth pyramid, into the plane of the
 *  image's `ping`. */
function encodeFurthest(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  hiz: HizDepth,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping } = context
  const { programs } = resources
  const plane = textures.furthest[ping]
  const { next } = groups.furthest.identity
  next[0] = hiz
  next[1] = plane
  pass.setPipeline(programs.furthest.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.furthest) ??
      keptGroup(
        device,
        programs.furthest.layout,
        groups.furthest,
        furthestEntries(resources, hiz, plane.view),
      ),
  )
  pass.dispatchWorkgroups(threads(context.cells.x, 8), threads(context.cells.y, 8))
}

/** The light each cell scatters, blended with the volume of the image before. */
function encodeScatter(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping, whiteCubemap } = context
  const { next } = groups.scatter.identity
  const { vsm } = input
  next[0] = input.depth
  next[1] = input.lights
  next[2] = input.tiles
  next[3] = textures.scattering[ping]
  next[4] = textures.scattering[1 - ping]
  next[5] = textures.furthest[ping]
  next[6] = textures.furthest[1 - ping]
  next[7] = input.cubemap ?? whiteCubemap
  next[8] = vsm.pageTable
  next[9] = vsm.projectionData
  next[10] = vsm.uniforms
  next[11] = vsm.pool
  next[12] = vsm.view
  pass.setPipeline(resources.programs.scatter.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.scatter) ??
      keptGroup(
        device,
        resources.programs.scatter.layout,
        groups.scatter,
        scatterEntries(context, input, textures),
      ),
  )
  const { cells } = context
  pass.dispatchWorkgroups(threads(cells.x, 4), threads(cells.y, 4), threads(cells.z, 4))
}

/** The sum of the cells along each column. */
function encodeIntegrate(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping } = context
  const { next } = groups.integrate.identity
  const { scattering, integrated } = textures
  next[0] = scattering[ping]
  next[1] = integrated
  pass.setPipeline(resources.programs.integrate.pipeline.get())
  pass.setBindGroup(
    0,
    heldGroup(groups.integrate) ??
      keptGroup(
        device,
        resources.programs.integrate.layout,
        groups.integrate,
        integrateEntries(resources, scattering[ping].view, integrated.view),
      ),
  )
  pass.dispatchWorkgroups(threads(context.cells.x, 8), threads(context.cells.y, 8))
}

/**
 * The volume's passes over `textures`, in one compute pass: the furthest depth of the cells across
 * the image (where `skipHidden` holds cells hidden, from the pyramid `input.hiz` names), the light
 * each cell scatters blended with the volume of the image before, and the sum along each column.
 * This image's volume is the one `context.ping` names.
 */
export function encodeFogPasses(
  encoder: GPUCommandEncoder,
  context: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
  skipHidden: boolean,
) {
  const pass = encoder.beginComputePass({ label: FOG_VOLUME_PASS })
  if (skipHidden && input.hiz) encodeFurthest(pass, context, input.hiz, textures)
  encodeScatter(pass, context, input, textures)
  encodeIntegrate(pass, context, textures)
  pass.end()
}
