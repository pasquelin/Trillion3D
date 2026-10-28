import type { DistanceFieldOcclusionSettings } from '../../../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { AO_DOWNSAMPLE, CONE_DIRECTIONS, TILE_SIZE, occlusionBuffers, tileCounts } from './cones.ts'
import { CONE_GLOBAL_GROUP } from './coneGlobalWgsl.ts'
import { COMBINE_GROUP } from './combineWgsl.ts'
import { CULL_GROUP } from './cullWgsl.ts'
import { CLEAR_GROUP } from './gridWgsl.ts'
import { dfaoGroups, dfaoPackFrom, type DfaoSources } from './groups.ts'
import { DFAO_PARAMS } from './layout.ts'
import { dfaoPrograms, dfaoProgramsReady, type DfaoPrograms } from './pipelines.ts'
import { writeDfaoParams, type DfaoHistory, type DfaoImage, type DfaoScene } from './params.ts'
import { HISTORY_GROUP } from './historyWgsl.ts'
import { encodeTileScatter, tileScatterTargets } from '../tileScatter.ts'
import { ensureDfaoView, type DfaoView } from './view.ts'
import { objectCapacity } from '../../rays/meshTrace/gridPasses.ts'

const LABEL = 'Trillion3D distance-field occlusion'
const GRID_PASS: GPUComputePassDescriptor = { label: `${LABEL} grid` }
const CULL_PASS: GPUComputePassDescriptor = { label: `${LABEL} cull` }
const OFFSETS_PASS: GPUComputePassDescriptor = { label: `${LABEL} offsets` }
const CONES_PASS: GPUComputePassDescriptor = { label: `${LABEL} cones` }
const HISTORY_PASS: GPUComputePassDescriptor = { label: `${LABEL} history` }
const PACK_PASS: GPUComputePassDescriptor = { label: `${LABEL} pack` }
const SCATTER = tileScatterTargets(LABEL)
/** The image's compute passes that follow one another, one pass but on a frame timed per pass. */
const steps = new ComputeRun()

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
  /** Darkens the bent normals the history ended in before the lit pass reads them, without touching the history: given the
   *  encoder to dispatch on, the texture they are in (`rgba16float`, the bent normal and the depth in centimetres) and its size in
   *  pixels, it returns a texture of the same kind and size holding the image to light with, or nothing for the bent normals
   *  as they are (`encodeCapsuleSkyShadows`). */
  skyShadows?: (
    encoder: GPUCommandEncoder,
    bent: GPUTextureView,
    size: readonly [number, number],
  ) => GPUTextureView | undefined
}

const floats = new Float32Array(DFAO_PARAMS.words)
const words = new Uint32Array(floats.buffer)

/** The normals and depths grid, and the cones' visibilities set to one. */
function encodeGrid(programs: DfaoPrograms, view: DfaoView, groups: Record<string, GPUBindGroup>) {
  const { grid, cones } = occlusionBuffers(view.shape.extent)
  const pass = steps.pass(GRID_PASS)
  dispatchOn(
    pass,
    programs.single.normals,
    groups.normals,
    ceilDiv(grid[0], TILE_SIZE),
    ceilDiv(grid[1], TILE_SIZE),
  )
  dispatchOn(
    pass,
    programs.single.clear,
    groups.clear,
    ceilDiv(CONE_DIRECTIONS * cones[0] * cones[1], CLEAR_GROUP),
  )
}

/** The lists the tile lists fill, emptied: before the grid's pass, which they follow in the run. */
function clearTileLists(encoder: GPUCommandEncoder, view: DfaoView) {
  encoder.clearBuffer(view.objectArgs)
  encoder.clearBuffer(view.tileCounts)
  encoder.clearBuffer(view.tileArgs)
}

/** The meshes culled to the view, the tiles' cones, then each mesh's tiles counted, given their runs and written. */
function encodeTileLists(
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  image: DfaoImage,
) {
  const tiles = tileCounts(image.view[0], image.view[1])
  const first = steps.pass(CULL_PASS)
  dispatchOn(
    first,
    programs.single.cullObjects,
    groups.cullObjects,
    ceilDiv(view.shape.objects, CULL_GROUP),
  )
  dispatchOn(first, programs.single.tileCones, groups.tileCones, tiles[0], tiles[1])
  scatter(steps.apart(), programs, view, groups, tiles, 'count')
  const offsets = steps.pass(OFFSETS_PASS)
  dispatchOn(
    offsets,
    programs.single.startOffsets,
    groups.startOffsets,
    ceilDiv(view.shape.objects, CULL_GROUP),
  )
  steps.apart().clearBuffer(view.tileCounts)
  scatter(steps.apart(), programs, view, groups, tiles, 'write')
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
  SCATTER.target.view = view.standIn.view
  encodeTileScatter(
    encoder,
    SCATTER[which],
    which === 'count' ? programs.countTiles : programs.writeTiles,
    groups.scatter,
    tiles[0],
    tiles[1],
    view.objectArgs,
    programs.sphere,
  )
}

/** The cones traced against the global field and the meshes' fields, then combined into bent normals. */
function encodeCones(
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  using: { global: boolean; objects: boolean; settings: DistanceFieldOcclusionSettings },
) {
  const { cones } = occlusionBuffers(view.shape.extent)
  const pass = steps.pass(CONES_PASS)
  if (using.global) {
    dispatchOn(
      pass,
      programs.coneGlobal(using.objects),
      groups.coneGlobal,
      ceilDiv(cones[0], CONE_GLOBAL_GROUP),
      ceilDiv(cones[1], CONE_GLOBAL_GROUP),
    )
  }
  const objects = using.objects
    ? programs
        .coneObjects({ global: using.global, traverseMips: using.settings.traverseMips })
        .get()
    : undefined
  if (objects) {
    pass.setPipeline(objects)
    pass.setBindGroup(0, groups.coneObjects)
    pass.dispatchWorkgroupsIndirect(view.tileArgs, 0)
  }
  dispatchOn(
    pass,
    programs.single.combine,
    groups.combine,
    ceilDiv(cones[0], COMBINE_GROUP),
    ceilDiv(cones[1], COMBINE_GROUP),
  )
}

/**
 * The bent normals upsampled to the grid and filtered over time: with a history to read, the upsample mixed with the last
 * image's where the surface was (and, with the stability pass, the values that dropped their history filled from the
 * stable ones round them, into the history's own texture); else the upsample alone, which becomes the history. Returns
 * the texture the image is in, and which holds the history next.
 */
function encodeHistory(
  programs: DfaoPrograms,
  view: DfaoView,
  groups: Record<string, GPUBindGroup>,
  using: { read: boolean; stability: boolean },
) {
  const size = view.shape.extent
  const [width, height] = occlusionBuffers(size).grid
  const pass = steps.pass(HISTORY_PASS)
  const step = (program: 'upsampleOnly' | 'updateHistory' | 'filterHistory') => {
    dispatchOn(
      pass,
      programs.single[program],
      groups[program],
      ceilDiv(width, HISTORY_GROUP),
      ceilDiv(height, HISTORY_GROUP),
    )
  }
  step(using.read ? 'updateHistory' : 'upsampleOnly')
  const stable = using.read && using.stability
  if (stable) step('filterHistory')
  return stable ? view.historyAt : ((1 - view.historyAt) as 0 | 1)
}

/** The image the history ended in, in the texture `at` of the history (`encodeHistory`), packed into the buffer the lit pass
 *  reads (`packWgsl.ts`). */
function encodePack(programs: DfaoPrograms, view: DfaoView, group: GPUBindGroup) {
  const [width, height] = occlusionBuffers(view.shape.extent).grid
  const pass = steps.pass(PACK_PASS)
  dispatchOn(
    pass,
    programs.single.pack,
    group,
    ceilDiv(width, HISTORY_GROUP),
    ceilDiv(height, HISTORY_GROUP),
  )
}

type Dfao = {
  programs: ReturnType<typeof dfaoPrograms>
  view: NonNullable<DfaoState['view']>
}

/** The view the image is drawn into, made again where it cannot hold the image (`state.why` says why it cannot be made). */
function dfaoViewOf(state: DfaoState, device: GPUDevice, inputs: DfaoInputs) {
  const { view, why } = ensureDfaoView(state.view, device, {
    extent: inputs.image.extent,
    objects: objectCapacity(inputs.objects?.count ?? 0),
    perTile: inputs.settings.objectsPerCullTile,
  })
  state.view = view
  state.why = why
  return view
}

/** The image's parameters written and the bind groups of its passes. */
function uploadDfao(
  device: GPUDevice,
  programs: Dfao['programs'],
  view: Dfao['view'],
  inputs: DfaoInputs,
  reading: boolean,
) {
  const history: DfaoHistory = { lastView: reading ? view.lastView : undefined }
  writeDfaoParams(
    floats,
    words,
    inputs.image,
    inputs.settings,
    {
      objects: inputs.objects?.count ?? 0,
      sphereIndices: programs.sphere.indexCount,
      distances: inputs.distances,
    },
    history,
  )
  device.queue.writeBuffer(view.params, 0, floats)
  return dfaoGroups(
    device,
    programs,
    view,
    { ...inputs, vectors: inputs.vectors ?? programs.noVectors },
    view.historyAt,
  )
}

/** The passes of an image in order: the grid, the tile lists and the cones, the history and the pack; the view's history moved on. */
function encodeDfaoChain(
  c: Dfao & {
    device: GPUDevice
    encoder: GPUCommandEncoder
    groups: ReturnType<typeof dfaoGroups>
    inputs: DfaoInputs
    global: boolean
    traced: boolean
    reading: boolean
  },
) {
  const { device, encoder, programs, view, groups, inputs, global, traced } = c
  const { settings, image } = inputs
  if (traced) clearTileLists(encoder, view)
  steps.begin(encoder)
  encodeGrid(programs, view, groups)
  if (traced) encodeTileLists(programs, view, groups, image)
  encodeCones(programs, view, groups, { global, objects: traced, settings })
  const at = encodeHistory(programs, view, groups, {
    read: c.reading,
    stability: settings.stabilityPass,
  })
  const lit = inputs.skyShadows?.(
    steps.apart(),
    view.history[at].view,
    occlusionBuffers(view.shape.extent).grid,
  )
  encodePack(programs, view, lit ? dfaoPackFrom(device, programs, view, lit) : groups[`pack${at}`])
  steps.end()
  view.historyAt = at
  view.historyValid = settings.useHistory
  view.lastView = [
    Math.floor(image.view[0] / AO_DOWNSAMPLE),
    Math.floor(image.view[1] / AO_DOWNSAMPLE),
  ]
}

/**
 * THE DISTANCE-FIELD OCCLUSION OF AN IMAGE (`encodeDistanceFieldOcclusion`), before the lighting that reads it:
 * the normals and depths grid; the cones' visibilities set to one; where the meshes' fields are traced, the
 * meshes culled to the view, their tiles listed and the cones traced against them; the cones traced against the global
 * field; the visibilities combined into bent normals; the bent normals upsampled and filtered over time; the image
 * packed into the buffer the lit pass reads (`view.packed`). It returns the view that holds the image, at the grid's
 * resolution, or nothing — and states why — where it cannot be drawn: no field to trace, the programs still compiling,
 * or the memory budget.
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
  // Every pipeline of the chain asked here, before the view, the params or the history move.
  if (!dfaoProgramsReady(programs, { global, objects: traced ? shape : undefined }))
    return undefined
  const view = dfaoViewOf(state, device, inputs)
  if (!view) return undefined
  const reading = settings.useHistory && view.historyValid && !inputs.historyCut
  const groups = uploadDfao(device, programs, view, inputs, reading)
  encodeDfaoChain({ device, encoder, programs, view, groups, inputs, global, traced, reading })
  return view
}
