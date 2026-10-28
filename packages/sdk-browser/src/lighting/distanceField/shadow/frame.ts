import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { encodeTileScatter, tileScatterTargets } from '../tileScatter.ts'
import { objectCapacity } from '../../rays/meshTrace/gridPasses.ts'
import { dfshGroups, type DfshGroups, type DfshSources } from './groups.ts'
import {
  DFSH_CULL_GROUP,
  DFSH_FINAL,
  DFSH_MAX_LIGHTS,
  DFSH_OFFSET_GROUP,
  DFSH_PARAMS_STRIDE,
  DFSH_TILE,
} from './layout.ts'
import {
  boundsOf,
  downsampleOf,
  tilesOf,
  traceSize,
  writeDfshFinal,
  writeDfshParams,
  type DfshImage,
  type DfshLight,
  type DfshSettings,
} from './params.ts'
import { dfshPrograms, dfshProgramsReady, type DfshPrograms } from './pipelines.ts'
import { ensureDfshView, type DfshView } from './view.ts'

const LABEL = 'Trillion3D sun distance-field shadow'
const CULL_PASS: GPUComputePassDescriptor = { label: `${LABEL} cull` }
const OFFSETS_PASS: GPUComputePassDescriptor = { label: `${LABEL} offsets` }
const TRACE_PASS: GPUComputePassDescriptor = { label: `${LABEL} trace` }
const MASK_PASS: GPUComputePassDescriptor = { label: `${LABEL} mask` }
const SCATTER = tileScatterTargets(LABEL)
/** The image's compute passes that follow one another, one pass but on a frame timed per pass. */
const steps = new ComputeRun()

/** What the host holds of a view's sun shadow between images: its resources. */
export interface DfshState {
  view: DfshView | undefined
  /** Why the shadow was not drawn, where the budget refused it. */
  why: string | undefined
}

/** A state with nothing drawn. */
export const createDfshState = (): DfshState => ({ view: undefined, why: undefined })

/** What an image gives the shadow to draw: the camera, the view's settings, the suns whose cascade is
 *  traced (at most four, each its own lane) and what the passes read of the frame. */
export interface DfshInputs {
  image: DfshImage
  settings: DfshSettings
  lights: readonly DfshLight[]
  sources: DfshSources
}

const floats = new Float32Array((DFSH_MAX_LIGHTS * DFSH_PARAMS_STRIDE) / 4)
const words = new Uint32Array(floats.buffer)
const finalFloats = new Float32Array(DFSH_FINAL.words)
const finalWords = new Uint32Array(finalFloats.buffer)

/** The meshes' bounding boxes drawn into the grid of tiles: the count pass or the write pass. */
function scatter(
  encoder: GPUCommandEncoder,
  programs: DfshPrograms,
  view: DfshView,
  groups: Pick<DfshGroups, 'scatter'>,
  draw: { side: number; offset: number; which: 'count' | 'write' },
) {
  const { side, offset, which } = draw
  SCATTER.target.view = view.standIn.view
  encodeTileScatter(
    encoder,
    SCATTER[which],
    which === 'count' ? programs.countTiles : programs.writeTiles,
    groups.scatter,
    side,
    side,
    view.objectArgs,
    undefined,
    offset,
  )
}

/** A light's meshes listed by the tiles of its shadow space: the meshes culled to it, then — scattered to the grid of tiles
 *  (`distanceFieldShadowScatterTiles`) — their tiles counted, given their runs and written (the count and the runs only where the
 *  lists are compacted, `distanceFieldShadowCompactTiles`). The passes go into the run `steps` is in. */
function listMeshes(
  programs: DfshPrograms,
  view: DfshView,
  groups: Pick<DfshGroups, 'cull' | 'offsets' | 'scatter'>,
  cascade: { side: number; index: number; objects: number; settings: DfshSettings },
) {
  const { side, index, objects, settings } = cascade
  const { scatterTiles, compactTiles } = settings
  const offset = index * DFSH_PARAMS_STRIDE
  const tiles = side * side * 4
  const apart = steps.apart()
  apart.clearBuffer(view.objectArgs)
  if (scatterTiles) {
    if (compactTiles) apart.clearBuffer(view.nextOffset)
    apart.clearBuffer(view.tileCounts, 0, tiles)
  }
  const culling = steps.pass(CULL_PASS)
  dispatchOn(
    culling,
    programs.compute.cull,
    groups.cull,
    ceilDiv(objects, DFSH_CULL_GROUP),
    1,
    offset,
  )
  if (scatterTiles && compactTiles) {
    scatter(steps.apart(), programs, view, groups, { side, offset, which: 'count' })
    const offsets = steps.pass(OFFSETS_PASS)
    dispatchOn(
      offsets,
      programs.compute.offsets,
      groups.offsets,
      ceilDiv(side, DFSH_OFFSET_GROUP),
      ceilDiv(side, DFSH_OFFSET_GROUP),
      offset,
    )
    steps.apart().clearBuffer(view.tileCounts, 0, tiles)
  }
  if (scatterTiles) {
    scatter(steps.apart(), programs, view, groups, { side, offset, which: 'write' })
  }
}

/** A light's meshes listed by the tiles of its shadow space alone, in `encoder` (`listMeshes`): the lights of the surface cache, which are
 *  traced from the cache's own rays. */
export function encodeShadowTiles(
  encoder: GPUCommandEncoder,
  programs: DfshPrograms,
  view: DfshView,
  groups: Pick<DfshGroups, 'cull' | 'offsets' | 'scatter'>,
  cascade: { side: number; index: number; objects: number; settings: DfshSettings },
) {
  steps.begin(encoder)
  listMeshes(programs, view, groups, cascade)
  steps.end()
}

/**
 * One light's cascade: its meshes listed (`listMeshes`), then the pixels' rays traced through the tile's meshes, or, gathered, through the
 * meshes each group of texels culled to itself. The trace writes the light's layer of the half-resolution result.
 */
function encodeCascade(
  programs: DfshPrograms,
  view: DfshView,
  groups: DfshGroups,
  cascade: {
    side: number
    index: number
    objects: number
    settings: DfshSettings
    image: DfshImage
  },
) {
  const { index, settings, image } = cascade
  const { scatterTiles } = settings
  const offset = index * DFSH_PARAMS_STRIDE
  listMeshes(programs, view, groups, cascade)
  const [width, height] = traceSize(image.view, downsampleOf(settings))
  const tracing = steps.pass(TRACE_PASS)
  dispatchOn(
    tracing,
    scatterTiles ? programs.compute.trace : programs.compute.traceGather,
    scatterTiles ? groups.trace : groups.traceGather,
    ceilDiv(width, DFSH_TILE),
    ceilDiv(height, DFSH_TILE),
    offset,
  )
}

/** The view the image is drawn into, made again where it cannot hold the image: the objects, the tiles and the layers of the most it has held (`state.why` says why it cannot be made). */
function dfshViewOf(
  state: DfshState,
  device: GPUDevice,
  inputs: DfshInputs,
  sides: readonly number[],
) {
  const { image, settings, lights, sources } = inputs
  const held = state.view?.shape
  const { view, why } = ensureDfshView(state.view, device, {
    extent: image.extent,
    view: image.view,
    objects: Math.max(held?.objects ?? 0, objectCapacity(sources.objects.count)),
    // The grid of tiles and its lists only where the meshes are scattered to it: one tile otherwise.
    tiles: settings.scatterTiles ? Math.max(held?.tiles ?? 0, ...sides) : 1,
    perTile: settings.scatterTiles ? settings.perTile : 1,
    layers: Math.max(held?.layers ?? 0, lights.length),
    fullResolution: settings.fullResolution,
  })
  state.view = view
  state.why = why
  return view
}

/** The parameters of each light's cascade and of the final pass, written. */
function uploadDfsh(
  device: GPUDevice,
  view: NonNullable<DfshState['view']>,
  inputs: DfshInputs,
  bounds: readonly ReturnType<typeof boundsOf>[],
) {
  const { image, settings, lights, sources } = inputs
  const scene = { objects: sources.objects.count }
  lights.forEach((light, index) =>
    writeDfshParams(
      floats,
      words,
      index,
      { image, light, bounds: bounds[index], layer: index },
      settings,
      scene,
    ),
  )
  device.queue.writeBuffer(view.params, 0, floats)
  writeDfshFinal(finalFloats, finalWords, image, lights, settings)
  device.queue.writeBuffer(view.final, 0, finalFloats)
}

/**
 * THE SUN'S DISTANCE-FIELD SHADOW OF AN IMAGE (`encodeSunFieldShadows`), before the lighting that reads
 * it: for each light, its cascade's meshes culled, listed by tile of the cascade's shadow space (or
 * left to each group of texels) and traced from the depth (`encodeCascade`); then the four lanes of the mask written, each pixel's
 * visibility upsampled and faded. It returns the mask (a buffer, a word a pixel, a byte a lane, the
 * square root of the visibility) or nothing — and states why — where it cannot be drawn: no light, the programs
 * still compiling, or the memory budget.
 */
export function encodeSunFieldShadows(
  state: DfshState,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  inputs: DfshInputs,
) {
  const { image, settings, lights, sources } = inputs
  if (!lights.length || sources.objects.count === 0) return undefined
  const programs = dfshPrograms(device)
  // Every pipeline of the chain asked here, before the view or the params move.
  if (!dfshProgramsReady(programs, settings)) return undefined
  const bounds = lights.map((light) => boundsOf(image, light))
  const sides = bounds.map((b) => tilesOf(b, settings))
  const view = dfshViewOf(state, device, inputs, sides)
  if (!view) return undefined
  uploadDfsh(device, view, inputs, bounds)
  const groups = dfshGroups(device, programs, view, sources)
  steps.begin(encoder)
  lights.forEach((_, index) =>
    encodeCascade(programs, view, groups, {
      side: sides[index],
      index,
      objects: sources.objects.count,
      settings,
      image,
    }),
  )
  const pass = steps.pass(MASK_PASS)
  dispatchOn(
    pass,
    programs.compute.final,
    groups.final,
    ceilDiv(image.view[0], DFSH_TILE),
    ceilDiv(image.view[1], DFSH_TILE),
  )
  steps.end()
  return view.mask
}
