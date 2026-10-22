import type { DistanceFieldOcclusionSettings } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { AO_DOWNSAMPLE, CONE_DIRECTIONS, TILE_SIZE, occlusionBuffers, tileCounts } from './cones.ts'
import { CONE_GLOBAL_GROUP } from './coneGlobalWgsl.ts'
import { COMBINE_GROUP } from './combineWgsl.ts'
import { CULL_GROUP } from './cullWgsl.ts'
import { CLEAR_GROUP } from './gridWgsl.ts'
import { dfaoGroups, type DfaoSources } from './groups.ts'
import { DFAO_PARAMS } from './layout.ts'
import { dfaoPrograms, dfaoProgramsReady, type DfaoPrograms } from './pipelines.ts'
import { writeDfaoParams, type DfaoHistory, type DfaoImage, type DfaoScene } from './params.ts'
import { HISTORY_GROUP } from './historyWgsl.ts'
import { ensureDfaoView, objectCapacity, type DfaoView } from './view.ts'

const LABEL = 'Trillion3D distance-field occlusion'

/** What the host holds of a view's occlusion between images: its resources. */
export interface DfaoState {
  view: DfaoView | undefined
  /** Why the occlusion was not drawn, where the budget refused it. */
  why: string | undefined
}

/** A state with nothing drawn. */
export const createDfaoState = (): DfaoState => ({ view: undefined, why: undefined })

/** What an image gives the occlusion to draw. */
export interface DfaoInputs extends Omit<DfaoSources, 'vectors'> {
  /** The surfaces' vectors of motion, where the velocity stage drew them (`image.velocity`). */
  vectors?: GPUTextureView
  settings: DistanceFieldOcclusionSettings
  image: DfaoImage
  /** The sky light's occlusion distances (`occlusionDistances`), in centimetres. */
  distances: DfaoScene['distances']
  /** The history is dropped this image: a camera cut, a transform reset, a cube capture. */
  historyCut: boolean
}

const floats = new Float32Array(DFAO_PARAMS.words)
const words = new Uint32Array(floats.buffer)

/** The normals and depths grid, and the cones' visibilities set to one. */
function encodeGrid(
  encoder: GPUCommandEncoder,
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
) {
  const { grid, cones } = occlusionBuffers(view.shape.extent)
  const pass = encoder.beginComputePass({ label: `${LABEL} grid` })
  pass.setPipeline(programs.single.normals.get())
  pass.setBindGroup(0, groups.normals)
  pass.dispatchWorkgroups(ceilDiv(grid[0], TILE_SIZE), ceilDiv(grid[1], TILE_SIZE))
  pass.setPipeline(programs.single.clear.get())
  pass.setBindGroup(0, groups.clear)
  pass.dispatchWorkgroups(ceilDiv(CONE_DIRECTIONS * cones[0] * cones[1], CLEAR_GROUP))
  pass.end()
}

/** The meshes culled to the view, the tiles' cones, then each mesh's tiles counted, given their runs and written. */
function encodeTileLists(
  encoder: GPUCommandEncoder,
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  image: DfaoImage,
) {
  const tiles = tileCounts(image.view[0], image.view[1])
  encoder.clearBuffer(view.objectArgs)
  encoder.clearBuffer(view.tileCounts)
  encoder.clearBuffer(view.tileArgs)
  const first = encoder.beginComputePass({ label: `${LABEL} cull` })
  first.setPipeline(programs.single.cullObjects.get())
  first.setBindGroup(0, groups.cullObjects)
  first.dispatchWorkgroups(ceilDiv(view.shape.objects, CULL_GROUP))
  first.setPipeline(programs.single.tileCones.get())
  first.setBindGroup(0, groups.tileCones)
  first.dispatchWorkgroups(tiles[0], tiles[1])
  first.end()
  scatter(encoder, programs, view, groups, tiles, 'count')
  const offsets = encoder.beginComputePass({ label: `${LABEL} offsets` })
  offsets.setPipeline(programs.single.startOffsets.get())
  offsets.setBindGroup(0, groups.startOffsets)
  offsets.dispatchWorkgroups(ceilDiv(view.shape.objects, CULL_GROUP))
  offsets.end()
  encoder.clearBuffer(view.tileCounts)
  scatter(encoder, programs, view, groups, tiles, 'write')
}

/** The bounding spheres of the culled meshes drawn into the tile grid: the count pass or the write pass. */
function scatter(
  encoder: GPUCommandEncoder,
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  tiles: readonly [number, number],
  which: 'count' | 'write',
) {
  const pass = encoder.beginRenderPass({
    label: `${LABEL} ${which} tiles`,
    colorAttachments: [{ view: view.standIn.view, loadOp: 'clear', storeOp: 'discard' }],
  })
  pass.setViewport(0, 0, tiles[0], tiles[1], 0, 1)
  pass.setPipeline((which === 'count' ? programs.countTiles : programs.writeTiles).get())
  pass.setBindGroup(0, groups.scatter)
  pass.setVertexBuffer(0, programs.sphere.vertices)
  pass.setIndexBuffer(programs.sphere.indices, 'uint16')
  pass.drawIndexedIndirect(view.objectArgs, 0)
  pass.end()
}

/** The cones traced against the global field and the meshes' fields, then combined into bent normals. */
function encodeCones(
  encoder: GPUCommandEncoder,
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  using: { global: boolean; objects: boolean; settings: DistanceFieldOcclusionSettings },
) {
  const { cones } = occlusionBuffers(view.shape.extent)
  const pass = encoder.beginComputePass({ label: `${LABEL} cones` })
  if (using.global) {
    pass.setPipeline(programs.coneGlobal(using.objects).get())
    pass.setBindGroup(0, groups.coneGlobal)
    pass.dispatchWorkgroups(
      ceilDiv(cones[0], CONE_GLOBAL_GROUP),
      ceilDiv(cones[1], CONE_GLOBAL_GROUP),
    )
  }
  if (using.objects) {
    pass.setPipeline(
      programs
        .coneObjects({ global: using.global, traverseMips: using.settings.traverseMips })
        .get(),
    )
    pass.setBindGroup(0, groups.coneObjects)
    pass.dispatchWorkgroupsIndirect(view.tileArgs, 0)
  }
  pass.setPipeline(programs.single.combine.get())
  pass.setBindGroup(0, groups.combine)
  pass.dispatchWorkgroups(ceilDiv(cones[0], COMBINE_GROUP), ceilDiv(cones[1], COMBINE_GROUP))
  pass.end()
}

/**
 * The bent normals upsampled to the grid and filtered over time: with a history to read, the upsample mixed with the last
 * image's where the surface was (and, with the stability pass, the values that dropped their history filled from the
 * stable ones round them, into the history's own texture); else the upsample alone, which becomes the history. Returns
 * the texture the image is in, and which holds the history next.
 */
function encodeHistory(
  encoder: GPUCommandEncoder,
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  using: { read: boolean; stability: boolean },
) {
  const size = view.shape.extent
  const [width, height] = occlusionBuffers(size).grid
  const pass = encoder.beginComputePass({ label: `${LABEL} history` })
  const dispatch = () =>
    pass.dispatchWorkgroups(ceilDiv(width, HISTORY_GROUP), ceilDiv(height, HISTORY_GROUP))
  const step = (program: 'upsampleOnly' | 'updateHistory' | 'filterHistory') => {
    pass.setPipeline(programs.single[program].get())
    pass.setBindGroup(0, groups[program])
    dispatch()
  }
  step(using.read ? 'updateHistory' : 'upsampleOnly')
  const stable = using.read && using.stability
  if (stable) step('filterHistory')
  pass.end()
  return stable ? view.historyAt : ((1 - view.historyAt) as 0 | 1)
}

/**
 * THE DISTANCE-FIELD OCCLUSION OF AN IMAGE (`encodeDistanceFieldOcclusion`), before the lighting that reads it
 * (`dfaoReadWgsl`): the normals and depths grid; the cones' visibilities set to one; where the meshes' fields are traced, the
 * meshes culled to the view, their tiles listed and the cones traced against them; the cones traced against the global
 * field; the visibilities combined into bent normals; the bent normals upsampled and filtered over time. It returns the
 * texture of the image, at the grid's resolution, or nothing — and states why — where it cannot be drawn: no field to
 * trace, the programs still compiling, or the memory budget.
 */
export function encodeDistanceFieldOcclusion(
  state: DfaoState,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  inputs: DfaoInputs,
) {
  const { settings, image, field, objects } = inputs
  const global = !!field && inputs.distances.global > 0 && (objects?.count ?? 0) > 0
  const traced = settings.objects && !!objects && objects.count > 0
  if (!global && !traced) return undefined
  const programs = dfaoPrograms(device)
  const shape = { global, traverseMips: settings.traverseMips }
  if (!dfaoProgramsReady(programs, { global, objects: traced ? shape : undefined }))
    return undefined
  const { view, why } = ensureDfaoView(state.view, device, {
    extent: image.extent,
    objects: objectCapacity(objects?.count ?? 0),
    perTile: settings.objectsPerCullTile,
  })
  state.view = view
  state.why = why
  if (!view) return undefined
  const reading = settings.useHistory && view.historyValid && !inputs.historyCut
  const history: DfaoHistory = { lastView: reading ? view.lastView : undefined }
  writeDfaoParams(
    floats,
    words,
    image,
    settings,
    {
      objects: objects?.count ?? 0,
      sphereIndices: programs.sphere.indexCount,
      distances: inputs.distances,
    },
    history,
  )
  device.queue.writeBuffer(view.params, 0, floats)
  const groups = dfaoGroups(
    device,
    programs,
    view,
    { ...inputs, vectors: inputs.vectors ?? programs.noVectors },
    view.historyAt,
  )
  encodeGrid(encoder, programs, view, groups)
  if (traced) encodeTileLists(encoder, programs, view, groups, image)
  encodeCones(encoder, programs, view, groups, { global, objects: traced, settings })
  const at = encodeHistory(encoder, programs, view, groups, {
    read: reading,
    stability: settings.stabilityPass,
  })
  view.historyAt = at
  view.historyValid = settings.useHistory
  view.lastView = [
    Math.floor(image.view[0] / AO_DOWNSAMPLE),
    Math.floor(image.view[1] / AO_DOWNSAMPLE),
  ]
  return view.history[at].view
}
