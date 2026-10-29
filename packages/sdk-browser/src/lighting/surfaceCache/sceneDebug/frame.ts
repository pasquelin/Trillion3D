import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { createTextOverlay, TEXT_LINE } from '../../../diagnostic/textOverlay.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createGpuPeriodicReadback } from '../../../gpu/core/periodicReadback.ts'
import { DEBUG_COLORS } from '../../../hair/debugLines.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import {
  INTEGRATE_TILE_ARGS_WORDS,
  integrateTileGrid,
} from '../../bounce/screen/screenProbeLayout.ts'
import { encodeProbePlacement } from './probePlacement.ts'
import { createGpuLines, type GpuLines } from './gpuLines.ts'
import { directLightCounts, directLightingStatsLines } from './directLightingStats.ts'
import {
  PROBE_COUNTER_WORDS,
  TILE_MODE_NAMES,
  probeDebugOf,
  probeDebugShown,
  radianceCacheStatsLines,
  screenProbeCounterLines,
  tileStatsLines,
  type ProbeDebug,
} from './probeTables.ts'
import {
  CONTEXT_HEADER_READ_WORDS,
  lightingStatsLines,
  sceneDebugOf,
  sceneDebugShown,
  sceneStatsLines,
  type SceneDebug,
} from './views.ts'

/**
 * THE SURFACE CACHE'S DEBUG VIEWS over the display image, drawn after the image is composed (`views.ts` says which): the table of an update of the lighting, read back from the
 * update context's header a few images late, the counts of the scene, and the box of every placement that has mesh cards. Text and boxes go through the lines the hair strands' views draw
 * (`../../../hair/debugLines.ts`). Nothing, and every resource given back, while none is asked.
 */

/** The text starts a tenth of the display in from its top left corner; the count of the screen probes, four fifths of the way along. */
const TABLE_AT = 0.1
const COUNTERS_AT = 0.8

/** The colours of the three modes' names in the legend of the tiles, in the order of `TILE_MODE_NAMES`. */
const TILE_LEGEND_COLORS = [DEBUG_COLORS.green, DEBUG_COLORS.orange, DEBUG_COLORS.cyan] as const

interface DebugState {
  readonly text: ReturnType<typeof createTextOverlay>
  readonly header: Uint32Array<ArrayBuffer>
  readonly reader: ReturnType<typeof createGpuPeriodicReadback>
  /** The lines the GPU appends, made at the first image a view that draws them is shown. */
  gpuLines?: GpuLines
  /** The screen probes' counters, read back like the header while a probe view asks: made at the first image that does. */
  probes?: {
    readonly words: Uint32Array<ArrayBuffer>
    readonly reader: ReturnType<typeof createGpuPeriodicReadback>
  }
}
/** The corners of the box being drawn, metres. */
const low = new Float64Array(3)
const high = new Float64Array(3)
const states = new WeakMap<object, DebugState>()

const stateOf = (rt: WebgpuPagesRuntime, device: GPUDevice): DebugState => {
  let state = states.get(rt)
  if (!state) {
    const header = new Uint32Array(CONTEXT_HEADER_READ_WORDS)
    const reader = createGpuPeriodicReadback(
      device,
      { label: 'Trillion3D surface cache context header', bytes: header.byteLength, eager: true },
      (mapped) => header.set(new Uint32Array(mapped, 0, header.length)),
    )
    state = { text: createTextOverlay(device), header, reader }
    states.set(rt, state)
  }
  return state
}

/** Gives the passes of a runtime's surface cache debug views back. */
export function disposeSceneDebug(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  state?.text.dispose()
  state?.reader.dispose()
  state?.probes?.reader.dispose()
  state?.gpuLines?.dispose()
  states.delete(rt)
}

/** Requests mapping of the header, once the frame that copied it is submitted. */
export function sceneDebugSubmitted(rt: object) {
  const state = states.get(rt)
  state?.reader.submitted()
  state?.probes?.reader.submitted()
}

/** Writes the lines of a table `across` the display (a fraction of its width) from its tenth down, one under the other, starting at line `firstLine`, and returns the line after the last. */
function writeTable(
  state: DebugState,
  size: readonly [number, number],
  lines: readonly string[],
  firstLine: number,
  color: number = DEBUG_COLORS.white,
  across = TABLE_AT,
) {
  lines.forEach((line, at) =>
    state.text.lines.text(
      line,
      Math.round(size[0] * across),
      Math.round(size[1] * TABLE_AT) + (firstLine + at) * TEXT_LINE,
      color,
    ),
  )
  return firstLine + lines.length
}

/** Copies the update context's header on the images a sample is due. */
function sampleHeader(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, state: DebugState) {
  const context = rt.surfaceCache?.lighting?.resources?.context
  const { reader } = state
  if (
    context &&
    reader.due(rt.run.frame) &&
    reader.copy(encoder, context, 0, state.header.byteLength)
  )
    reader.sampled(rt.run.frame)
}

/** The readback of the screen probes' counters, made at the first image a probe view asks for it. */
function probeReadback(state: DebugState, device: GPUDevice) {
  if (!state.probes) {
    const words = new Uint32Array(PROBE_COUNTER_WORDS)
    const reader = createGpuPeriodicReadback(
      device,
      { label: 'Trillion3D screen probe counters', bytes: words.byteLength, eager: true },
      (mapped) => words.set(new Uint32Array(mapped, 0, words.length)),
    )
    state.probes = { words, reader }
  }
  return state.probes
}

/** Copies the screen probes' counters on the images a sample is due: the count of adaptive probes, then the integration's tile buffer where the tiles are classified (its counts are in
 *  the words after the arguments of the three modes). */
function sampleProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  probes: NonNullable<DebugState['probes']>,
) {
  const resources = rt.gpu.screenProbes?.resources
  const { reader } = probes
  if (!resources || !reader.due(rt.run.frame)) return
  const classified = resources.tileArgs.size >= INTEGRATE_TILE_ARGS_WORDS * 4
  if (
    reader.copy(encoder, resources.counts, 0, 4) &&
    (!classified || reader.copy(encoder, resources.tileArgs, 0, INTEGRATE_TILE_ARGS_WORDS * 4))
  )
    reader.sampled(rt.run.frame)
}

/** Draws the surface cache's tables and boxes, from the line the first table begins at; returns the line after them. */
function drawCacheViews(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  state: DebugState,
  view: SceneDebug,
) {
  const { gpu } = rt
  const surface = rt.surfaceCache!
  const { lines } = state.text
  let next = 0
  if (view.lightingStats > 0) {
    sampleHeader(rt, encoder, state)
    if (state.reader.ready && surface.lighting?.resources && surface.atlases) {
      const table =
        view.lightingStats === 3
          ? directLightingStatsLines(
              directLightCounts(rt, surface.settings),
              surface.atlases.side,
              surface.settings,
              state.header,
            )
          : lightingStatsLines(state.header, view.lightingStats === 1 ? 0 : 1)
      next = writeTable(state, gpu.displaySize, table, next)
    }
  }
  if (view.sceneStats && surface.metrics)
    next = writeTable(
      state,
      gpu.displaySize,
      sceneStatsLines({ ...surface.metrics, ...surface.cache.stats }),
      next,
    )
  if (view.primitiveGroups) {
    for (const { meshCards, bounds } of surface.cache.placements.values()) {
      if (meshCards < 0) continue
      for (let k = 0; k < 3; k++) {
        low[k] = bounds[k]! / CM
        high[k] = bounds[3 + k]! / CM
      }
      lines.box(low, high, DEBUG_COLORS.white)
    }
  }
  return next
}

/** Draws the probes' tables: the world's probes update statistics and the integration's tiles from line `next` down, the screen probes' count at the right. */
function drawProbeViews(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  view: ProbeDebug,
  first: number,
) {
  const size = rt.gpu.displaySize
  let next = first
  const counters = view.gatherCounters || view.tileStats ? probeReadback(state, device) : undefined
  if (counters) sampleProbes(rt, encoder, counters)
  const radiance = rt.bounce.probes
  if (view.radianceCacheStats && radiance)
    next = writeTable(
      state,
      size,
      radianceCacheStatsLines(radiance.stats, radiance.cascades.probes),
      next,
    )
  const screen = rt.gpu.screenProbes
  if (!counters?.reader.ready || !screen?.image) return
  if (view.gatherCounters) {
    const { geometry } = screen.resources
    writeTable(
      state,
      size,
      screenProbeCounterLines(geometry.uniform, Math.min(counters.words[0]!, geometry.maxAdaptive)),
      0,
      DEBUG_COLORS.white,
      COUNTERS_AT,
    )
  }
  if (view.tileStats) {
    const classified = screen.resources.tileArgs.size >= INTEGRATE_TILE_ARGS_WORDS * 4
    const { integrateDownsample } = screenProbeSettingsOf(rt)
    const tiles = integrateTileGrid(screen.image, integrateDownsample)
    next = writeTable(
      state,
      size,
      classified ? tileStatsLines(tiles, counters.words) : ['Tiles are not classified'],
      next,
      DEBUG_COLORS.silver,
    )
    if (classified)
      TILE_MODE_NAMES.forEach((name, mode) => {
        next = writeTable(state, size, [name], next, TILE_LEGEND_COLORS[mode])
      })
  }
}

/** Appends the lines the probes' views draw, from the records of the image the probes last cast. Returns the lines drawn, none where the probes cast no image. */
function appendProbeLines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  view: ProbeDebug,
) {
  const screen = rt.gpu.screenProbes
  if (!view.placement) {
    state.gpuLines?.dispose()
    state.gpuLines = undefined
    return undefined
  }
  if (!screen?.history || !screen.image) return undefined
  const lines = (state.gpuLines ??= createGpuLines(device))
  lines.begin(encoder)
  encodeProbePlacement(
    device,
    encoder,
    lines,
    screen.resources,
    screen.image,
    (1 - screen.turn) as 0 | 1,
    rt.gpu.displaySize,
    view.placement,
  )
  lines.end(encoder)
  return lines.appended
}

/** Draws the surface cache's and the probes' debug views over the display image of `rt`. */
export function encodeSceneDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const surface = rt.surfaceCache
  const cacheView = surface && sceneDebugOf(surface.settings, rt.run.diagnostic)
  const probeView = probeDebugOf(screenProbeSettingsOf(rt).values, rt.run.diagnostic)
  const cacheShown = !!cacheView && sceneDebugShown(cacheView)
  if (!(cacheShown || probeDebugShown(probeView)) || !gpu.displayView) return disposeSceneDebug(rt)
  const state = stateOf(rt, device)
  state.text.begin(cam)
  const next = cacheShown ? drawCacheViews(rt, encoder, state, cacheView) : 0
  drawProbeViews(rt, device, encoder, state, probeView, next)
  const appended = appendProbeLines(rt, device, encoder, state, probeView)
  state.text.encode(encoder, gpu.displayView, gpu.displaySize, cam, appended)
}
