import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { createTextOverlay, TEXT_LINE } from '../../../diagnostic/textOverlay.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { DEBUG_COLORS } from '../../../hair/debugLines.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { pageTableClipmapResolution } from '../../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { globalReadLayoutEntries } from '../view.ts'
import {
  PAGE_STATS_ENTRIES,
  PAGE_STATS_GROUP,
  PAGE_STATS_WGSL,
  PAGE_STATS_WORDS,
} from './pageStatsWgsl.ts'

const LABEL = 'Trillion3D global distance field page statistics'
/** The text's place over the image, as parts of its size. */
const LEFT = 0.8
const TOP = 0.2
const STATS_BYTES = PAGE_STATS_WORDS * 4

const programs = oncePerDevice((device: GPUDevice) => {
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        label: `${LABEL} reads`,
        entries: globalReadLayoutEntries(0, false),
      }),
      device.createBindGroupLayout({
        label: `${LABEL} words`,
        entries: [computeBufferEntry(0, 'storage'), computeBufferEntry(1, 'read-only-storage')],
      }),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: PAGE_STATS_WGSL })
  const stage = (entry: string) =>
    preparedComputeStage(
      device,
      pipelineLayout,
      module,
      entry,
      undefined,
      `${LABEL} ${entry}`,
    ).ask()
  return { pages: stage(PAGE_STATS_ENTRIES.pages), totals: stage(PAGE_STATS_ENTRIES.totals) }
})

/** The words read back: the pages in use, those with no surface, those composited, the free ones, and the most the atlas holds. */
interface PageStats {
  readonly words: readonly [number, number, number, number]
  readonly max: number
}

interface PageStatsState {
  readonly overlay: ReturnType<typeof createTextOverlay>
  readonly ring: ReadbackRing<number>
  readonly stats: GPUBuffer
  read: PageStats | undefined
}

const states = new WeakMap<object, PageStatsState>()

/** The lines of the table: the most pages, those allocated (none known without a maximum) and free, the combined, the empty and the updated. */
export function pageStatsLines({ words, max }: PageStats) {
  const [combined, empty, updated, free] = words
  return [
    ['GDF Pages', DEBUG_COLORS.white],
    [` Max   ${max}`, DEBUG_COLORS.white],
    [` Alloc ${max > 0 ? max - free : -1}`, DEBUG_COLORS.red],
    [` Free  ${free}`, DEBUG_COLORS.green],
    [` Combi ${combined}`, DEBUG_COLORS.white],
    [` Empty ${empty}`, DEBUG_COLORS.white],
    [` Updated  ${updated}`, DEBUG_COLORS.orange],
  ] as const
}

function stateOf(rt: object, device: GPUDevice) {
  const held = states.get(rt)
  if (held) return held
  const state: PageStatsState = {
    overlay: createTextOverlay(device),
    ring: createReadbackRing<number>(
      device,
      { label: LABEL, bytes: STATS_BYTES, count: 2 },
      (mapped, _staging, max) => {
        const words = new Uint32Array(mapped, 0, PAGE_STATS_WORDS)
        state.read = { words: [words[0]!, words[1]!, words[2]!, words[3]!], max }
      },
    ),
    stats: device.createBuffer({
      label: LABEL,
      size: STATS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    }),
    read: undefined,
  }
  states.set(rt, state)
  return state
}

/** Gives the text, the buffer and the readback of a runtime back. */
export function disposePageStats(rt: object) {
  const state = states.get(rt)
  if (!state) return
  state.overlay.dispose()
  state.ring.destroy()
  state.stats.destroy()
  states.delete(rt)
}

/** After the frame's submit: the copy of the words, which lands a few frames late. */
export const pageStatsSubmitted = (rt: object) => states.get(rt)?.ring.submitted()

/**
 * THE GLOBAL FIELD'S PAGE STATISTICS (`globalDistanceFieldDebugShowStats`), written over the display image once the field is updated: the pages of the clipmaps in use
 * and those among them holding no surface counted by a kernel over every clipmap's page table, the pages composited this image and the free ones taken from the
 * field's control words, read back a few frames late.
 */
export function encodeGlobalFieldStats(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const frame = rt.distanceFields
  const res = frame?.scene.field.resources
  const { displayView, displaySize } = rt.gpu
  if (!frame?.settings.globalDistanceFieldDebugShowStats || !res || !displayView)
    return disposePageStats(rt)
  const { pages, totals } = programs(device)
  const pagesPipeline = pages.get(),
    totalsPipeline = totals.get()
  if (!pagesPipeline || !totalsPipeline) return
  const state = stateOf(rt, device)
  encoder.clearBuffer(state.stats)
  const reads = device.createBindGroup({
    layout: pagesPipeline.getBindGroupLayout(0),
    entries: frame.scene.readEntries(0),
  })
  const words = device.createBindGroup({
    layout: pagesPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: state.stats } },
      { binding: 1, resource: { buffer: res.control } },
    ],
  })
  const along = pageTableClipmapResolution(frame.settings)
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setBindGroup(0, reads)
  pass.setBindGroup(1, words)
  pass.setPipeline(pagesPipeline)
  pass.dispatchWorkgroups(
    ceilDiv(along, PAGE_STATS_GROUP),
    ceilDiv(along, PAGE_STATS_GROUP),
    ceilDiv(along * res.clipmaps, PAGE_STATS_GROUP),
  )
  pass.setPipeline(totalsPipeline)
  pass.dispatchWorkgroups(1)
  pass.end()
  rt.run.gpuComputeDispatches += 2
  const staging = state.ring.take(res.maxPages, STATS_BYTES)
  if (staging) encoder.copyBufferToBuffer(state.stats, 0, staging, 0, STATS_BYTES)
  state.overlay.begin(cam)
  if (state.read)
    pageStatsLines(state.read).forEach(([line, color], at) =>
      state.overlay.lines.text(
        line,
        LEFT * displaySize[0],
        TOP * displaySize[1] + at * TEXT_LINE,
        color,
      ),
    )
  state.overlay.encode(encoder, displayView, displaySize, cam)
}
