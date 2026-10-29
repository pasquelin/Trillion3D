import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import { INTEGRATE_TILE_ARGS_WORDS } from '../../bounce/screen/screenProbeLayout.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createGpuLines, type GpuLines } from './gpuLines.ts'
import { encodeProbePlacement } from './probePlacement.ts'
import type { ProbeDebug } from './probeTables.ts'
import { encodeTileQuads } from './tileQuads.ts'
import { visualizeTonemapBindings } from './visualizeTonemap.ts'
import { createReflectionTraces, type ReflectionTraces } from './reflectionTraces.ts'
import { createProbeTraces, type ProbeTraces } from './traceLines.ts'

/**
 * THE LINES THE PROBES' VIEWS APPEND over the display image, from the records of the image the screen probes last cast: where the probes stand (`probePlacement.ts`) and the
 * integration's tiles (`tileQuads.ts`) and the rays of the probe nearest to the cursor (`traceLines.ts`, whose buffer `traces` keeps between images), and the reflection ray under the cursor
 * (`reflectionTraces.ts`).
 */

/** Whether a view of the probes draws lines. */
export const probeLinesShown = (view: ProbeDebug) =>
  view.placement > 0 || view.tileStats || view.traces || view.reflectionTraces

/** What the probes' lines keep between images: the lines the GPU appends, the rays of the probe the traces view follows and the reflection ray under the cursor, made at the first image a view that draws is shown. */
export interface ProbeLineState {
  gpuLines?: GpuLines
  traces?: ProbeTraces
  reflection?: ReflectionTraces
}

/** Appends the lines of `view` to `lines`; whether the probes had an image cast to draw from. */
export function appendProbeLines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lines: GpuLines,
  view: ProbeDebug,
  traces: ProbeTraces,
  reflection: ReflectionTraces | undefined,
) {
  const size = rt.gpu.displaySize
  const reflected = !!reflection?.encode(rt, encoder, lines, view.cursor, size)
  const screen = rt.gpu.screenProbes
  if (!screen?.image) return reflected
  if (view.placement)
    encodeProbePlacement(
      device,
      encoder,
      lines,
      screen.resources,
      screen.image,
      // The records of the image just cast: the hand-over moved the turn on.
      (1 - screen.turn) as 0 | 1,
      size,
      view.placement,
    )
  if (view.tileStats && screen.resources.tileArgs.size >= INTEGRATE_TILE_ARGS_WORDS * 4)
    encodeTileQuads(
      device,
      encoder,
      lines,
      screen.resources,
      screen.image,
      screenProbeSettingsOf(rt).integrateDownsample,
      size,
    )
  const tone = view.traces ? visualizeTonemapBindings(rt) : undefined
  if (tone)
    traces.encode(
      encoder,
      lines,
      screen.resources,
      screen.image,
      // The records of the image just cast, as the placement reads them.
      (1 - screen.turn) as 0 | 1,
      {
        cursor: view.cursor,
        size,
        frozen: view.tracesFrozen,
        importance: screenProbeSettingsOf(rt).values.screenProbeImportanceSampling,
        tonemapped: view.tracesTonemapped && tone.baked,
        depthTested: view.tracesDepthTested,
        tone: tone.resources,
      },
    )
  return true
}

/** Draws the lines the probes' views append, made at the first image one is shown and given back when none is. Returns what the lines pass draws, none where nothing was appended. */
export function drawProbeLines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: ProbeLineState,
  view: ProbeDebug,
) {
  const screen = rt.gpu.screenProbes
  const drawn = view.reflectionTraces || (screen?.history && screen.image && probeLinesShown(view))
  if (!drawn) {
    state.gpuLines?.dispose()
    state.gpuLines = undefined
    state.traces?.dispose()
    state.traces = undefined
    state.reflection?.dispose()
    state.reflection = undefined
    return undefined
  }
  const lines = (state.gpuLines ??= createGpuLines(device))
  lines.begin(encoder)
  const traces = (state.traces ??= createProbeTraces(device))
  if (!view.reflectionTraces) {
    state.reflection?.dispose()
    state.reflection = undefined
  } else state.reflection ??= createReflectionTraces(device)
  const appended = appendProbeLines(rt, device, encoder, lines, view, traces, state.reflection)
  lines.end(encoder)
  return appended ? { ...lines.appended, depth: rt.gpu.depthView } : undefined
}
