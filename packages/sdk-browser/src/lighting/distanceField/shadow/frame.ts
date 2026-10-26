import { heldColour } from '../../../gpu/core/heldAttachment.ts'
import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { objectCapacity } from '../ao/view.ts'
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
const scatterTarget = heldColour({ loadOp: 'clear', storeOp: 'discard' })
const COUNT_TILES: GPURenderPassDescriptor = {
  label: `${LABEL} count tiles`,
  colorAttachments: [scatterTarget],
}
const WRITE_TILES: GPURenderPassDescriptor = {
  label: `${LABEL} write tiles`,
  colorAttachments: [scatterTarget],
}
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

/** Runs `stage` on `group` at the dynamic `offset`, over `x` × `y` workgroups; nothing while it is not compiled. */
function dispatchAt(
  pass: GPUComputePassEncoder,
  stage: { get(): GPUComputePipeline | undefined },
  group: GPUBindGroup,
  offset: number,
  x: number,
  y = 1,
) {
  const pipeline = stage.get()
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group, [offset])
  pass.dispatchWorkgroups(x, y)
}

/** The meshes' bounding boxes drawn into the grid of tiles: the count pass or the write pass. */
function scatter(
  encoder: GPUCommandEncoder,
  programs: DfshPrograms,
  view: DfshView,
  groups: DfshGroups,
  draw: { side: number; offset: number; which: 'count' | 'write' },
) {
  const { side, offset, which } = draw
  scatterTarget.view = view.standIn.view
  const pipeline = (which === 'count' ? programs.countTiles : programs.writeTiles).get()
  if (!pipeline) return
  const pass = encoder.beginRenderPass(which === 'count' ? COUNT_TILES : WRITE_TILES)
  pass.setViewport(0, 0, side, side, 0, 1)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, groups.scatter, [offset])
  pass.drawIndirect(view.objectArgs, 0)
  pass.end()
}

/**
 * One light's cascade: the meshes culled to it, their tiles counted, given their runs and written,
 * then the pixels' rays traced through the tile's meshes into the light's layer of the half-resolution
 * result.
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
  const { side, index, objects, settings, image } = cascade
  const offset = index * DFSH_PARAMS_STRIDE
  const tiles = side * side * 4
  const apart = steps.apart()
  apart.clearBuffer(view.objectArgs)
  apart.clearBuffer(view.nextOffset)
  apart.clearBuffer(view.tileCounts, 0, tiles)
  const culling = steps.pass(CULL_PASS)
  dispatchAt(culling, programs.compute.cull, groups.cull, offset, ceilDiv(objects, DFSH_CULL_GROUP))
  scatter(steps.apart(), programs, view, groups, { side, offset, which: 'count' })
  const offsets = steps.pass(OFFSETS_PASS)
  dispatchAt(
    offsets,
    programs.compute.offsets,
    groups.offsets,
    offset,
    ceilDiv(side, DFSH_OFFSET_GROUP),
    ceilDiv(side, DFSH_OFFSET_GROUP),
  )
  steps.apart().clearBuffer(view.tileCounts, 0, tiles)
  scatter(steps.apart(), programs, view, groups, { side, offset, which: 'write' })
  const [width, height] = traceSize(image.view, downsampleOf(settings))
  const tracing = steps.pass(TRACE_PASS)
  dispatchAt(
    tracing,
    programs.compute.trace,
    groups.trace,
    offset,
    ceilDiv(width, DFSH_TILE),
    ceilDiv(height, DFSH_TILE),
  )
}

/**
 * THE SUN'S DISTANCE-FIELD SHADOW OF AN IMAGE (`encodeSunFieldShadows`), before the lighting that reads
 * it: for each light, its cascade's meshes culled, listed by tile of the cascade's shadow space and
 * traced from the depth (`encodeCascade`); then the four lanes of the mask written, each pixel's
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
  if (!dfshProgramsReady(programs)) return undefined
  const bounds = lights.map((light) => boundsOf(image, light))
  const sides = bounds.map((b) => tilesOf(b, settings))
  const held = state.view?.shape
  const { view, why } = ensureDfshView(state.view, device, {
    extent: image.extent,
    view: image.view,
    objects: Math.max(held?.objects ?? 0, objectCapacity(sources.objects.count)),
    tiles: Math.max(held?.tiles ?? 0, ...sides),
    perTile: settings.perTile,
    layers: Math.max(held?.layers ?? 0, lights.length),
    fullResolution: settings.fullResolution,
  })
  state.view = view
  state.why = why
  if (!view) return undefined
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
