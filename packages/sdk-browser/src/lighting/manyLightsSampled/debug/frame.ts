/**
 * THE SAMPLED LIGHTING'S DEBUG VIEWS over the display image, drawn after the image is composed: the numbered views of the denoiser (`modes.ts`, `visualizeWgsl.ts`) in one screen pass
 * a tile with their label, the tiles of the classification (`tileOverlay.ts`) and the count of rays each trace method got. Text goes through the lines the hair strands' views draw
 * (`../../../hair/debugLines.ts`). Nothing, and every pass given back, while none is asked.
 */
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createGpuPeriodicReadback } from '../../../gpu/core/periodicReadback.ts'
import {
  drawScreenPass,
  screenPassGroup,
  screenPassPipeline,
} from '../../../diagnostic/screenPass.ts'
import { createTextOverlay, TEXT_LINE } from '../../../diagnostic/textOverlay.ts'
import { DEBUG_COLORS } from '../../../hair/debugLines.ts'
import { followSampledLights } from '../frame.ts'
import { SAMPLED_TILE_MODES } from '../parameters.ts'
import { overviewLayout, tileRect, visualizeLabel, visualizeViewOf, isOverview } from './modes.ts'
import { debugPixelsOf, releaseDebugPixels, sampledOfFrame } from './state.ts'
import { createTileOverlay, tileClassificationOf, writeTileTable } from './tileOverlay.ts'
import { VISUALIZE_BLOCK_WORDS, VISUALIZE_ENTRY, VISUALIZE_WGSL } from './visualizeWgsl.ts'

/** The pixels from the display's edge the tables start. */
const LINE = TEXT_LINE
const LEFT = 50

/** The bytes between the blocks of two tiles in the block buffer (a uniform binding's offset alignment) and the most tiles a view has. */
const BLOCK_STRIDE = 256
const MAX_TILES = 16

/** The bytes the readback holds: the trace counts, then the tiles' counts for the view and for the downsampled view. */
const COUNT_BYTES = 16
const TILE_COUNT_BYTES = SAMPLED_TILE_MODES * 4

interface DebugState {
  readonly text: ReturnType<typeof createTextOverlay>
  visualize?: { pipeline: ReturnType<typeof screenPassPipeline>; block: GPUBuffer }
  tiles?: ReturnType<typeof createTileOverlay>
  reader?: ReturnType<typeof createGpuPeriodicReadback>
  /** The last counts read back: the rays of the screen, the distance field and the shadow maps, then the tiles of the view and of the downsampled view by mode. */
  counts: Uint32Array
}
const states = new WeakMap<object, DebugState>()

const stateOf = (rt: WebgpuPagesRuntime, device: GPUDevice): DebugState => {
  let state = states.get(rt)
  if (!state) {
    const counts = new Uint32Array(4 + 2 * SAMPLED_TILE_MODES)
    state = { text: createTextOverlay(device), counts }
    state.reader = createGpuPeriodicReadback(
      device,
      {
        label: 'Trillion3D sampled debug counts',
        bytes: COUNT_BYTES + 2 * TILE_COUNT_BYTES,
        eager: true,
      },
      (mapped) => counts.set(new Uint32Array(mapped, 0, counts.length)),
    )
    states.set(rt, state)
  }
  return state
}

/** Gives the passes of a runtime's sampled lighting debug views back. */
export function disposeSampledDebug(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  state?.text.dispose()
  state?.visualize?.block.destroy()
  state?.tiles?.dispose()
  state?.reader?.dispose()
  states.delete(rt)
  releaseDebugPixels(rt)
}

/** Requests mapping of the counts, once the frame that copied them is submitted. */
export const sampledDebugSubmitted = (rt: object) => states.get(rt)?.reader?.submitted()

/** The numbered views, one screen pass a tile, with their labels written at the foot of each. */
function drawVisualize(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  view: number,
) {
  const { gpu } = rt
  const samples = sampledOfFrame(rt, rt.run.frame)
  const target = gpu.displayView
  if (!samples || !target) return
  const values = followSampledLights(rt)
  const visualize = (state.visualize ??= {
    pipeline: screenPassPipeline(
      device,
      'Trillion3D sampled visualize',
      VISUALIZE_WGSL,
      VISUALIZE_ENTRY,
    ),
    block: device.createBuffer({
      label: 'Trillion3D sampled visualize block',
      size: BLOCK_STRIDE * MAX_TILES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  })
  const debugPixels = debugPixelsOf(rt)
  const pipeline = visualize.pipeline.get()
  if (!pipeline || !debugPixels) return
  const layout = overviewLayout(view)
  const single = !isOverview(view)
  const size = gpu.displaySize
  layout.tiles.forEach((tile, index) => {
    if (tile < 0) return
    const rect = tileRect(size, index, layout.perRow, single)
    const label = visualizeLabel(tile)
    const words = new Float32Array(VISUALIZE_BLOCK_WORDS)
    words.set(rect, 0)
    words.set(
      [
        samples.geometry.view[0],
        samples.geometry.view[1],
        values.sampledLightsTemporalMaxFrames,
        values.sampledLightsSpatialHistoryDeviation,
      ],
      4,
    )
    new Uint32Array(words.buffer).set([tile, single ? 0 : 1], 8)
    // One block a tile: the writes land before the commands run, so a shared block would give every tile the last one's.
    const offset = index * BLOCK_STRIDE
    device.queue.writeBuffer(visualize.block, offset, words)
    drawScreenPass(
      encoder,
      'Trillion3D sampled visualize',
      pipeline,
      target,
      [
        screenPassGroup(device, pipeline, [
          { buffer: visualize.block, offset, size: VISUALIZE_BLOCK_WORDS * 4 },
          samples.resolvedDiffuse,
          samples.filtered.diffuse,
          samples.filtered.specular,
          samples.filtered.frames,
          debugPixels,
        ]),
      ],
      rect,
    )
    if (label)
      state.text.lines.text(label, rect[0] + 8, rect[1] + rect[3] - 20, DEBUG_COLORS.yellow)
  })
}

/** The tiles of the classification the setting asks for, and the table of their counts. */
function drawTiles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  setting: number,
) {
  const { gpu } = rt
  const samples = sampledOfFrame(rt, rt.run.frame)
  const target = gpu.displayView
  if (!samples || !target) return
  const { input, downsampled } = tileClassificationOf(setting)
  // Only the surfaces' tiles are kept for the view: the hair strands' and the nearest layer's classification are their own images'.
  if (input !== 0) return
  const { geometry, debug } = samples
  const overlay = (state.tiles ??= createTileOverlay(device))
  const scale: [number, number] = [
    gpu.displaySize[0] / geometry.view[0],
    gpu.displaySize[1] / geometry.view[1],
  ]
  overlay.encode(
    encoder,
    target,
    gpu.displaySize,
    scale,
    downsampled ? geometry.downsample[0] : 1,
    geometry.tileListStride,
    downsampled ? debug.downAllocator : debug.allocator,
    downsampled ? debug.downData : debug.data,
  )
  const at = 4 + (downsampled ? SAMPLED_TILE_MODES : 0)
  writeTileTable(
    state.text.lines,
    state.counts.subarray(at, at + SAMPLED_TILE_MODES),
    LEFT,
    40,
    LINE,
  )
}

/** The count of rays each trace method got, written from the right fifth of the image. */
function writeTraceStats(state: DebugState, size: readonly [number, number]) {
  const x = Math.round(size[0] * 0.8)
  const rows: [string, number][] = [
    ['VSM', state.counts[2]!],
    ['Screen', state.counts[0]!],
    ['World', state.counts[1]!],
    ['World Mtrl Retrace', 0],
    ['Volume', 0],
    ['TLV Cascade 0', 0],
    ['TLV Cascade 1', 0],
  ]
  let y = Math.round(size[1] * 0.3)
  state.text.lines.text('Trace Stats', x, y, DEBUG_COLORS.emerald)
  for (const [name, count] of rows)
    state.text.lines.text(`${name.padEnd(18)}: ${count}`, x, (y += LINE), DEBUG_COLORS.white)
}

/** Copies the counts the views write out, on a sampled image. */
function sampleCounts(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, state: DebugState) {
  const samples = sampledOfFrame(rt, rt.run.frame)
  const reader = state.reader
  if (!samples || !reader?.due(rt.run.frame)) return
  const { debug } = samples
  if (!reader.copy(encoder, debug.compactCount, 0, COUNT_BYTES)) return
  reader.sampled(rt.run.frame)
  reader.copy(encoder, debug.allocator, 0, TILE_COUNT_BYTES)
  reader.copy(encoder, debug.downAllocator, 0, TILE_COUNT_BYTES)
}

/** Whether the image draws any view of the sampled lighting's debug (`encodeSampledDebug`). */
export function sampledDebugAsked(rt: WebgpuPagesRuntime) {
  const values = followSampledLights(rt)
  return (
    values.sampledLights &&
    (visualizeViewOf(values, rt.run.diagnostic) > 0 ||
      values.sampledLightsVisualizeTileClassification > 0 ||
      (values.sampledLightsDebug > 0 && values.sampledLightsDebugTraceStats))
  )
}

/** Draws the sampled lighting's debug views over the display image of `rt`. */
export function encodeSampledDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  if (!sampledDebugAsked(rt) || !gpu.displayView) return disposeSampledDebug(rt)
  const values = followSampledLights(rt)
  const state = stateOf(rt, device)
  state.text.begin(cam)
  sampleCounts(rt, encoder, state)
  const view = visualizeViewOf(values, rt.run.diagnostic)
  if (view > 0) drawVisualize(rt, device, encoder, state, view)
  if (values.sampledLightsVisualizeTileClassification > 0)
    drawTiles(rt, device, encoder, state, values.sampledLightsVisualizeTileClassification)
  if (values.sampledLightsDebug > 0 && values.sampledLightsDebugTraceStats)
    writeTraceStats(state, gpu.displaySize)
  state.text.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
