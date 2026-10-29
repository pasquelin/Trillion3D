import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import { createTextOverlay, TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import { debugColor } from '../../../../hair/debugLines.ts'
import { VSM_MIPS } from '../constants.ts'

/** The text's place over the image: from the top, and from the left, as parts of its size. */
const TOP_MARGIN = 0.35
const ITEM_X = 0.08
/** The bytes of a map's rect in `vsmMappedRects` (four words), and of the rects one map holds (a rect a mip). */
const RECT_BYTES = 16
const MAP_BYTES = RECT_BYTES * VSM_MIPS
const READBACKS = 2
const WHITE = debugColor(1, 1, 1)

/** One level of the clipmap: the rect of pages its map has allocated (min x, min y, max x, max y), the area it spans where it is not empty. */
interface LevelStats {
  readonly rect: readonly [number, number, number, number]
  readonly area: number | undefined
}

interface ClipmapStatsState {
  readonly overlay: ReturnType<typeof createTextOverlay>
  readonly ring: ReadbackRing<number>
  /** The levels read back last, none until a copy has landed. */
  levels: readonly LevelStats[]
  /** The first map of the clipmap shown: another one empties the table until its copy lands. */
  firstId: number
}

const states = new WeakMap<WebgpuPagesRuntime, ClipmapStatsState>()

/** The levels of the clipmap in the bytes of `vsmMappedRects` copied from its first map: a rect a level, from its map's first mip. */
export function readClipmapStats(words: Uint32Array, levelCount: number): LevelStats[] {
  const levels: LevelStats[] = []
  for (let level = 0; level < levelCount; level++) {
    const at = level * VSM_MIPS * 4
    const rect = [words[at]!, words[at + 1]!, words[at + 2]!, words[at + 3]!] as const
    const empty = rect[0] > rect[2] || rect[1] > rect[3]
    levels.push({
      rect,
      area: empty ? undefined : (rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1),
    })
  }
  return levels
}

/** The lines of the table: the title, a line a level (the rect, its width, height and area where it holds pages), the total area. */
export function clipmapStatsLines(levels: readonly LevelStats[]): string[] {
  let total = 0
  const lines = levels.map(({ rect, area }) => {
    if (area === undefined) return rect.join(' ')
    total += area
    return `${rect.join(' ')} ${rect[2] - rect[0] + 1} ${rect[3] - rect[1] + 1} ${area}`
  })
  return ['Allocated Page Rects', ...lines, `Total Area ${total}`]
}

function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const held = states.get(rt)
  if (held) return held
  const state: ClipmapStatsState = {
    overlay: createTextOverlay(device),
    ring: createReadbackRing<number>(
      device,
      { label: 'vsm.clipmapStats', bytes: 4096, count: READBACKS },
      (mapped, _staging, levelCount) => {
        state.levels = readClipmapStats(new Uint32Array(mapped), levelCount)
      },
    ),
    levels: [],
    firstId: -1,
  }
  states.set(rt, state)
  return state
}

/** Gives the text and the readback of a runtime back. */
export function disposeClipmapStats(rt: object) {
  const state = states.get(rt as WebgpuPagesRuntime)
  state?.overlay.dispose()
  state?.ring.destroy()
  states.delete(rt as WebgpuPagesRuntime)
}

/** After the frame's submit: the copy of the rects maps, and lands a few frames late. */
export const clipmapStatsSubmitted = (rt: object) =>
  states.get(rt as WebgpuPagesRuntime)?.ring.submitted()

/**
 * THE CLIPMAP'S STATISTICS (`shadowShowClipmapStats`, the index of the sun clipmap to show, -1 off), written over the display image: the rect of pages each level of the clipmap has
 * allocated, its size and area, and the total area. The rects (`vsmMappedRects`) are copied to a staging buffer and read a few frames late, as the shadow counters are.
 */
export function encodeClipmapStats(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const vsm = rt.lights?.vsm
  const wanted = vsm?.state.maps.shadows.shadowShowClipmapStats ?? -1
  const lane = wanted >= 0 ? vsm?.plan?.projected.filter((l) => l.clipmap)[wanted] : undefined
  if (!vsm || !lane?.clipmap || !gpu.displayView) return disposeClipmapStats(rt)
  const state = stateOf(rt, device)
  const levelCount = lane.clipmap.levels.length
  if (state.firstId !== lane.firstId) {
    state.firstId = lane.firstId
    state.levels = []
  }
  const staging = state.ring.take(levelCount, levelCount * MAP_BYTES)
  if (staging)
    encoder.copyBufferToBuffer(
      vsm.res.current.mappedRects,
      lane.firstId * MAP_BYTES,
      staging,
      0,
      levelCount * MAP_BYTES,
    )
  const [width, height] = gpu.displaySize
  state.overlay.begin(cam)
  clipmapStatsLines(state.levels).forEach((line, at) =>
    state.overlay.lines.text(line, ITEM_X * width, TOP_MARGIN * height + at * TEXT_LINE, WHITE),
  )
  state.overlay.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
