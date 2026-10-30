import { writeDividedVector3 } from '../../../../math/src/vector/vector.ts'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createCachedGroup } from '../../gpu/bind/cachedGroup.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import {
  FLAGS_VIEW,
  SURFACE_COLOURS_FORMAT,
  SURFACE_WORDS_FORMAT,
  viewOf,
} from '../../materials/surface/surfaceOutputs.ts'
import { chainReady } from '../deferred/fullscreen.ts'
import { askSpheresPipeline, beginSpheresPass } from '../debugSpheres.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { LIGHTING_ONLY_BRIGHTNESS } from '../deferred/litSurfaceWgsl.ts'
import { lightViewCode } from '../../visibility/shader/shadeMode.ts'
import { volumetricLightmapLayoutEntries } from './textures.ts'
import {
  VISUALIZE_VIEWER_WORDS,
  VLM_VISUALIZE_WGSL,
  visualizeInstances,
  visualizeQuadIndices,
} from './visualizeWgsl.ts'

const read = contextReader(VOLUMETRIC_LIGHTMAP_RULES)
/** The grey of the spheres: a surface of the scene's average reflectance, or the brightness the lighting view gives every surface. */
const SPHERE_ALBEDO = 0.18
const LIGHTING_ONLY_ALBEDO = Number(LIGHTING_ONLY_BRIGHTNESS)
/** The `lightViewCode` of the view of the lighting alone. */
const LIGHTING_VIEW = lightViewCode('lighting')
/** The place of the base colour in the surfaces' views. */
const BASE_VIEW = viewOf('baseMetal')

/** The layouts, the pipeline and the indices of one instance's quads, once a device and compiled off the frame: drawn into the surfaces before the lighting. */
const spheres = oncePerDevice((device: GPUDevice) => {
  const stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const viewer = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: stages, buffer: { type: 'uniform' } }],
  })
  const lightmap = device.createBindGroupLayout({
    entries: volumetricLightmapLayoutEntries(0, stages),
  })
  const pipeline = askSpheresPipeline(device, {
    label: VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS,
    module: device.createShaderModule({
      label: VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS,
      code: VLM_VISUALIZE_WGSL,
    }),
    vertex: 'vlmVisualizeVs',
    fragment: 'vlmVisualizeFs',
    layout: device.createPipelineLayout({ bindGroupLayouts: [viewer, lightmap] }),
    targets: [{ format: SURFACE_COLOURS_FORMAT }, { format: SURFACE_WORDS_FORMAT }],
  })
  const indices = visualizeQuadIndices()
  const indexBuffer = device.createBuffer({
    label: `${VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS} quads`,
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, indices)
  return { viewer, lightmap, pipeline, indexBuffer, indexCount: indices.length }
})

/** What the spheres hold of a runtime: the viewer block, the two cached bind groups and what they are made from. */
interface VisualizeState {
  readonly block: UniformBlock
  readonly viewerGroup: ReturnType<typeof createCachedGroup>
  readonly lightmapGroup: ReturnType<typeof createCachedGroup>
  readonly viewerResources: readonly unknown[]
  readonly viewerEntries: () => GPUBindGroupEntry[]
  /** The lightmap the group names (the one resource), and its entries. */
  readonly lightmapResources: [Lightmap | undefined]
  readonly lightmapEntries: () => GPUBindGroupEntry[]
}
type Lightmap = NonNullable<WebgpuPagesRuntime['volumetricLightmap']>['gpu']
const states = new WeakMap<WebgpuPagesRuntime, VisualizeState>()
const RENDER_MATRIX = new Float64Array(16)

/** Gives the spheres' buffer back. */
export function disposeVolumetricLightmapVisualize(rt: WebgpuPagesRuntime) {
  states.get(rt)?.block.buffer.destroy()
  states.delete(rt)
}

function newState(device: GPUDevice): VisualizeState {
  const block = uniformBlock(
    device,
    `${VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS} viewer`,
    VISUALIZE_VIEWER_WORDS * 4,
  )
  const lightmapResources: [Lightmap | undefined] = [undefined]
  return {
    block,
    viewerGroup: createCachedGroup(),
    lightmapGroup: createCachedGroup(),
    viewerResources: [block.buffer],
    viewerEntries: () => [{ binding: 0, resource: { buffer: block.buffer } }],
    lightmapResources,
    lightmapEntries: () => lightmapResources[0]!.entries(0),
  }
}

/** The samples a side of `brickSize` cells on each of the indirection's sides holds. */
function cellsOf(indirectionSize: ArrayLike<number>, brickSize: number) {
  let cells = 1
  for (let axis = 0; axis < indirectionSize.length; axis++)
    cells *= indirectionSize[axis]! * brickSize
  return cells
}

/**
 * THE SAMPLES OF THE VOLUMETRIC LIGHTMAP (`volumetricLightmapVisualize`, `volumetricLightmapVisualizeRadiusScale`,
 * `volumetricLightmapVisualizeMinScreenFraction`): the sphere of every sample of the finest density (eight quads an instance, drawn indexed), lit by the harmonics the lightmap
 * stores there, drawn as unlit surfaces right after the opaque resolve — before the velocity, the tile classification and the lighting —: the fragment writes its colour in the
 * base layer and the unlit flag in the words of the surfaces, with the scene's depth tested and written, so the lighting, the subsurface scattering, the velocity and the fog treat the
 * spheres as any unlit surface. Nothing is drawn, and nothing is held, while it is not asked, the scene has no
 * lightmap or the `volumetricLightmap` setting is off.
 */
export function encodeVolumetricLightmapVisualize(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const lightmap = rt.volumetricLightmap?.gpu
  if (
    !read(rt, 'volumetricLightmapVisualize') ||
    !read(rt, 'volumetricLightmap') ||
    !lightmap ||
    !gpu.surfaces ||
    !gpu.depthView
  )
    return disposeVolumetricLightmapVisualize(rt)
  const { viewer, lightmap: lightmapLayout, pipeline, indexBuffer, indexCount } = spheres(device)
  if (!chainReady(pipeline)) return
  let state = states.get(rt)
  if (!state) states.set(rt, (state = newState(device)))
  const staged = state.block.words.f
  // The matrix the opaque surfaces were drawn with (jittered while the image accumulates), at the eye: the depth written here lands on theirs.
  matrixAtRenderOrigin(RENDER_MATRIX, taaRenderMatrix(rt, cam), cam.eye)
  staged.set(RENDER_MATRIX)
  staged.set(cam.eye, 16)
  writeDividedVector3(staged, 20, cam.world[0]!, cam.world[1]!, cam.world[2]!)
  staged[23] = cam.projection[0]!
  writeDividedVector3(staged, 24, cam.world[4]!, cam.world[5]!, cam.world[6]!)
  staged[27] = read(rt, 'volumetricLightmapVisualizeRadiusScale')
  staged[28] = read(rt, 'volumetricLightmapVisualizeMinScreenFraction')
  staged[29] =
    lightViewCode(rt.run.diagnostic) === LIGHTING_VIEW ? LIGHTING_ONLY_ALBEDO : SPHERE_ALBEDO
  state.block.send()
  const { data } = lightmap
  const cells = cellsOf(data.indirectionSize, data.brickSize)
  if (cells <= 0) return
  const surfaces = gpu.surfaces.views()
  const pass = beginSpheresPass(
    encoder,
    VOLUMETRIC_LIGHTMAP_VISUALIZE_PASS,
    [surfaces[BASE_VIEW]!, surfaces[FLAGS_VIEW]!],
    gpu.depthView,
  )
  pass.setPipeline(pipeline.get()!)
  pass.setBindGroup(
    0,
    state.viewerGroup(device, viewer, state.viewerResources, state.viewerEntries),
  )
  state.lightmapResources[0] = lightmap
  pass.setBindGroup(
    1,
    state.lightmapGroup(device, lightmapLayout, state.lightmapResources, state.lightmapEntries),
  )
  pass.setIndexBuffer(indexBuffer, 'uint16')
  pass.drawIndexed(indexCount, visualizeInstances(cells))
  pass.end()
}
