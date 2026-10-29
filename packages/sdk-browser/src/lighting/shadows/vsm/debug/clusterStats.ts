import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import { createTextOverlay, TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import { debugColor } from '../../../../hair/debugLines.ts'
import {
  VSM_FEEDBACK_ENTRY_WORDS,
  VSM_FEEDBACK_HEADER_WORDS,
  vsmFeedbackWords,
} from '../render/renderParamsWgsl.ts'
import { vsmFrameParity } from '../resources.ts'

/** The frames a map stays listed after it drew its last cluster. */
export const CLUSTER_STATS_HOLD = 180
/** The most maps listed (the reference's slots: 32 of one page and 96 of many). */
const MOST_LISTED = 128
const READBACKS = 2
const MARGIN_X = 10

/**
 * Whether the stats sections `sections` (`shadowShowStats`) hold the clusters': `all` or `1` every section, `basic` the basic ones alone, else a comma-separated list of section names,
 * read without regard to case.
 */
export function showsClusterStats(sections: string) {
  const text = sections.trim().toLowerCase()
  if (text === 'all' || text === '1') return true
  return text.split(',').some((name) => name.trim() === 'clusters')
}

/** The clusters each map drew in a frame, from the words of the feedback (`vsmFeedbackWords`): the hardware and the software raster's, summed. */
export function mapClusterCounts(words: Uint32Array, mapCount: number) {
  const counts = new Array<number>(mapCount)
  for (let id = 0; id < mapCount; id++) {
    const at = VSM_FEEDBACK_HEADER_WORDS + VSM_FEEDBACK_ENTRY_WORDS * id
    counts[id] = words[at]! + words[at + 1]!
  }
  return counts
}

/**
 * The rows of the table of one frame: a map is listed when it drew a cluster, and for `CLUSTER_STATS_HOLD` frames after its last one (`timers`, the frames left of each map listed, kept from frame to frame).
 * Each row is the map's id, its light's name and its clusters.
 */
export function clusterStatsRows(
  counts: readonly number[],
  lightOf: (id: number) => string,
  timers: Map<number, number>,
) {
  const rows = [`${'VSM Id'.padStart(6)} | ${'Light'.padStart(100)} | ${'# Clusters'.padStart(10)}`]
  for (let id = 0; id < Math.min(counts.length, MOST_LISTED); id++) {
    let listed = counts[id]! > 0
    if (listed) timers.set(id, CLUSTER_STATS_HOLD)
    else {
      const left = timers.get(id)
      if (left !== undefined) {
        listed = true
        if (left === 0) timers.delete(id)
        else timers.set(id, left - 1)
      }
    }
    if (listed)
      rows.push(
        `${String(id).padStart(6)} | ${lightOf(id).padStart(100)} | ${String(counts[id]).padStart(10)}`,
      )
  }
  return rows
}

interface ClusterStatsState {
  readonly overlay: ReturnType<typeof createTextOverlay>
  ring: ReadbackRing<number>
  mapSlots: number
  /** The table read back last, none until a copy has landed. */
  counts: readonly number[]
  readonly timers: Map<number, number>
}

const states = new WeakMap<WebgpuPagesRuntime, ClusterStatsState>()

const makeRing = (device: GPUDevice, state: () => ClusterStatsState, mapSlots: number) =>
  createReadbackRing<number>(
    device,
    { label: 'vsm.clusterStats', bytes: 4 * vsmFeedbackWords(mapSlots), count: READBACKS },
    (mapped, _staging, mapCount) => {
      state().counts = mapClusterCounts(new Uint32Array(mapped), mapCount)
    },
  )

/** Gives the text and the readback of a runtime back. */
export function disposeClusterStats(rt: object) {
  const state = states.get(rt as WebgpuPagesRuntime)
  state?.overlay.dispose()
  state?.ring.destroy()
  states.delete(rt as WebgpuPagesRuntime)
}

/** After the frame's submit: the copy of the clusters lands a few frames late. */
export const clusterStatsSubmitted = (rt: object) =>
  states.get(rt as WebgpuPagesRuntime)?.ring.submitted()

/**
 * THE CLUSTERS TABLE (`shadowShowStats` holding the clusters section), written over the display image at the lower left: for each map that drew clusters, its id, its light and the clusters
 * it drew, a map staying listed for `CLUSTER_STATS_HOLD` frames after its last. The counts are the raster's own (the throttle's feedback, counted while the section is shown), copied to a
 * staging buffer and read a few frames late.
 */
export function encodeClusterStats(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const vsm = rt.lights?.vsm
  const feedback = vsm?.res.throttle?.feedback[vsmFrameParity(vsm.res)]
  if (
    !vsm?.plan ||
    !feedback ||
    !gpu.displayView ||
    !showsClusterStats(vsm.state.maps.shadows.shadowShowStats)
  )
    return disposeClusterStats(rt)
  const mapSlots = vsm.res.throttle!.mapSlots
  let state = states.get(rt)
  if (state && state.mapSlots !== mapSlots) {
    disposeClusterStats(rt)
    state = undefined
  }
  if (!state) {
    const made: ClusterStatsState = {
      overlay: createTextOverlay(device),
      ring: undefined as never,
      mapSlots,
      counts: [],
      timers: new Map(),
    }
    made.ring = makeRing(device, () => made, mapSlots)
    states.set(rt, (state = made))
  }
  const { plan } = vsm
  const mapCount = Math.min(plan.projectionCount, mapSlots)
  const bytes = 4 * vsmFeedbackWords(mapCount)
  const staging = state.ring.take(mapCount, bytes)
  if (staging) encoder.copyBufferToBuffer(feedback, 0, staging, 0, bytes)
  const lightOf = (id: number) =>
    plan.lights.find((light) => id >= light.firstId && id < light.firstId + light.count)?.id ?? ''
  const rows = clusterStatsRows(state.counts, lightOf, state.timers)
  const [, height] = gpu.displaySize
  const top = Math.min(height - Math.floor(height / 3), height - (rows.length * TEXT_LINE + 20))
  state.overlay.begin(cam)
  rows.forEach((row, at) =>
    state.overlay.lines.text(row, MARGIN_X, top + at * TEXT_LINE, debugColor(1, 1, 1)),
  )
  state.overlay.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
