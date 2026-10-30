import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { createTextOverlay, TEXT_LINE } from '../../diagnostic/textOverlay.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'
import { DEBUG_COLORS, debugColor } from '../../hair/debugLines.ts'
import { FONT_CELLS } from '../../hair/debugFont.ts'
import type { PublishedVolume } from './gpu.ts'
import { createGpuLines, type GpuLines } from '../surfaceCache/sceneDebug/gpuLines.ts'
import {
  DEBUG_BOXES_BINDING,
  DEBUG_COUNT_WORDS,
  DEBUG_CULL_PLANES,
  DEBUG_CULL_WORDS,
  TV_DEBUG_BOXES_WGSL,
  TV_DEBUG_CULL_WGSL,
  debugGroups,
} from './debugWgsl.ts'
import { disposeTranslucencyVolumeSpheres } from './debugSpheres.ts'
import { TRANSLUCENCY_CASCADES } from './layout.ts'

const LABEL = 'Trillion3D translucency volume'
/** The most groups a dispatch holds along an axis: a cube whose depth slabs stacked pass it is not counted nor boxed. */
const MOST_GROUPS = 65535
/** Where the table begins, pixels from the display's corner, and the pixels a character of it is wide. */
const TABLE_AT = 50
const CELL = 2
const ADVANCE = FONT_CELLS.advance * CELL
/** The planes the cells are counted against, in `EngineCamera.planesRelative`'s slots: the sides, then the near plane. */
const CULL_SLOTS = [0, 4, 8, 12, 20] as const
/** The edges of a cell's box. */
const BOX_EDGES = 12
/** The lines the boxes' buffer holds: the twelve edges of a tenth of the cells of a 64-cell cube, the room the boxes ask by default. */
const BOX_LINE_CAPACITY = 1 << 19
/** The table's backdrop: black, a quarter opaque. */
const BACKDROP = debugColor(0, 0, 0, 0.25)

const cullKernel = autoKernel(`${LABEL} debug cells`, TV_DEBUG_CULL_WGSL, 'tvDebugCull')
const boxesKernel = autoKernel(`${LABEL} debug boxes`, TV_DEBUG_BOXES_WGSL, 'tvDebugBoxes')

interface DebugState {
  readonly text: ReturnType<typeof createTextOverlay>
  readonly lines: GpuLines
  readonly counts: GPUBuffer
  /** The last counts read back: the cells in view of each cascade, then the cells marked of each. */
  readonly seen: Uint32Array<ArrayBuffer>
  /** The cells a side of the cube `seen` was counted over. */
  dim: number
  /** The cells a side of the cube the copy in flight counted: a copy of another cube than `dim` is stale when it returns. */
  counted: number
  readonly reader: ReturnType<typeof createGpuPeriodicReadback>
  /** The planes the cells are counted against, then the word that says whether the cells are marked. */
  readonly cull: Float32Array<ArrayBuffer>
  readonly cullWords: Uint32Array
}
const states = new WeakMap<WebgpuPagesRuntime, DebugState>()

/** Gives the boxes' and the table's buffers and text back. */
function disposeBoxesAndTable(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  if (!state) return
  state.text.dispose()
  state.lines.dispose()
  state.counts.destroy()
  state.reader.dispose()
  states.delete(rt)
}

/** Gives everything the debug views of a runtime hold back: the spheres' and the boxes' and table's. */
export function disposeTranslucencyVolumeDebug(rt: WebgpuPagesRuntime) {
  disposeTranslucencyVolumeSpheres(rt)
  disposeBoxesAndTable(rt)
}

/** After the image's submit: the copy of the counts maps. */
export const translucencyVolumeDebugSubmitted = (rt: object) =>
  states.get(rt as WebgpuPagesRuntime)?.reader.submitted()

/** The text, the lines and the counts of the debug path, made when it is first asked for. */
function newState(device: GPUDevice): DebugState {
  const seen = new Uint32Array(DEBUG_COUNT_WORDS)
  const cull = new Float32Array(DEBUG_CULL_WORDS)
  const state: DebugState = {
    text: createTextOverlay(device),
    lines: createGpuLines(device, BOX_LINE_CAPACITY),
    counts: device.createBuffer({
      label: `${LABEL} debug counts`,
      size: DEBUG_COUNT_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    }),
    seen,
    dim: 0,
    counted: 0,
    reader: createGpuPeriodicReadback(
      device,
      { label: `${LABEL} debug counts readback`, bytes: DEBUG_COUNT_WORDS * 4, eager: true },
      (mapped) => {
        if (state.counted === state.dim) seen.set(new Uint32Array(mapped, 0, DEBUG_COUNT_WORDS))
      },
    ),
    cull,
    cullWords: new Uint32Array(cull.buffer),
  }
  return state
}

/** The text of a row of the table: `label` in white, `value` after it in yellow. */
function row(state: DebugState, line: number, label: string, value = '') {
  const y = TABLE_AT + line * TEXT_LINE
  const { lines } = state.text
  lines.text(label, TABLE_AT, y, DEBUG_COLORS.white, CELL)
  if (value) lines.text(value, TABLE_AT + label.length * ADVANCE, y, DEBUG_COLORS.yellow, CELL)
}

/** `count / cells (share%)`, the share to a tenth of a percent. */
const countText = (count: number, cells: number) =>
  `${count} / ${cells} (${((count * 100) / cells).toFixed(1).padStart(4)}%)`

/** The table of the volume, from the cascades' boxes and the counts last read back, its backdrop first and the text over it. */
function writeTable(state: DebugState, published: PublishedVolume, marking: boolean) {
  const cells = published.dim ** 3
  const rows: (readonly [string, string?])[] = [['Translucency Lighting Volume']]
  for (let cascade = 0; cascade < TRANSLUCENCY_CASCADES; cascade++) {
    const side = (1 / published.scale[4 * cascade]!).toFixed(2)
    // Where the cells are not marked, every cell is lit: the marked count is the cube's.
    const marked = marking ? state.seen[TRANSLUCENCY_CASCADES + cascade]! : cells
    rows.push(
      [`- Cascade ${cascade}:`],
      ['    - Size = ', `${side}, ${side}, ${side}`],
      ['    - # Visible Voxels = ', countText(state.seen[cascade]!, cells)],
      ['    - # Marked Voxels  = ', countText(marked, cells)],
    )
  }
  // The boxes past the lines' room are dropped by the pass that appends them: said, so the missing ones are not taken for unmarked cells.
  const edges = marking
    ? BOX_EDGES *
      state.seen
        .subarray(TRANSLUCENCY_CASCADES, 2 * TRANSLUCENCY_CASCADES)
        .reduce((sum, n) => sum + n, 0)
    : 0
  if (edges > state.lines.capacity)
    rows.push([
      '- Boxes dropped = ',
      `${ceilDiv(edges - state.lines.capacity, BOX_EDGES)} (lines full)`,
    ])
  const width = Math.max(
    ...rows.map(([label, value = '']) => (label.length + value.length) * ADVANCE),
  )
  state.text.lines.filled(
    TABLE_AT - ADVANCE / 2,
    TABLE_AT - TEXT_LINE / 2,
    TABLE_AT + width + ADVANCE / 2,
    TABLE_AT + rows.length * TEXT_LINE - TEXT_LINE / 2,
    BACKDROP,
  )
  rows.forEach(([label, value], line) => row(state, line, label, value))
}

/** The cells in view (and marked) counted, and the marked cells' boxes appended, over the cube of the volume. */
function describeCells(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DebugState,
  published: PublishedVolume,
  cam: EngineCamera,
  marking: boolean,
) {
  // Counts of another cube are no counts of this one, nor is a copy still in flight of the other cube's.
  if (state.dim !== published.dim) {
    state.seen.fill(0)
    state.dim = published.dim
  }
  const [x, y] = debugGroups(published.dim)
  if (y > MOST_GROUPS) return
  CULL_SLOTS.forEach((slot, at) =>
    state.cull.set(cam.planesRelative.subarray(slot, slot + 4), at * 4),
  )
  state.cullWords[DEBUG_CULL_PLANES * 4] = marking ? 1 : 0
  encoder.clearBuffer(state.counts)
  state.lines.run(
    encoder,
    cullKernel(device),
    [
      { buffer: published.frame },
      { buffer: state.lines.uniform('planes', state.cull.buffer) },
      published.marks,
      { buffer: state.counts },
    ],
    x,
    y,
  )
  if (
    state.reader.due(rt.run.frame) &&
    state.reader.copy(encoder, state.counts, 0, state.seen.byteLength)
  ) {
    state.reader.sampled(rt.run.frame)
    state.counted = published.dim
  }
  // Where the cells are not marked there are no marked cells to box.
  if (!marking) return
  const boxes: (GPUBindingResource | undefined)[] = []
  boxes[DEBUG_BOXES_BINDING.frame] = { buffer: published.frame }
  boxes[DEBUG_BOXES_BINDING.marks] = published.marks
  boxes[DEBUG_BOXES_BINDING.lines] = { buffer: state.lines.lines }
  boxes[DEBUG_BOXES_BINDING.count] = { buffer: state.lines.count }
  state.lines.run(encoder, boxesKernel(device), boxes, x, y)
}

/**
 * THE TRANSLUCENCY LIGHTING VOLUME'S BOXES AND TABLE OVER THE IMAGE (`translucencyVolumeDebug`), from the volume this image built: the box of
 * each cascade, the box of each marked cell and a table of each cascade's size, cells in view and cells marked (`TV_DEBUG_CULL_WGSL`, read back
 * a few images late). Its spheres are drawn into the lit image (`debugSpheres.ts`). Nothing is drawn, and nothing is held, while it is not
 * asked or the volume is not made.
 */
export function encodeTranslucencyVolumeDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const published = gpu.translucencyVolume?.gpu?.published
  const target = gpu.displayView
  if (!readSetting(TRANSLUCENCY_VOLUME_RULES, rt.context, 'translucencyVolumeDebug'))
    return disposeBoxesAndTable(rt)
  // The volume is not made this image (its pipelines compile, a cascade holds nothing): the view waits, what it holds is kept.
  if (!published?.view || !target) return
  let state = states.get(rt)
  if (!state) states.set(rt, (state = newState(device)))
  // Whether the volume published is the marked one: the setting may be on while the image fell back to lighting every cell.
  const marking = published.marked
  state.text.begin(cam)
  state.lines.begin(encoder)
  for (let cascade = 0; cascade < TRANSLUCENCY_CASCADES; cascade++) {
    const low = published.corner.subarray(4 * cascade, 4 * cascade + 3)
    const size = 1 / published.scale[4 * cascade]!
    state.text.lines.box(
      low,
      [low[0]! + size, low[1]! + size, low[2]! + size],
      cascade === 0 ? DEBUG_COLORS.green : DEBUG_COLORS.yellow,
    )
  }
  describeCells(rt, device, encoder, state, published, cam, marking)
  writeTable(state, published, marking)
  state.lines.end(encoder)
  state.text.encode(encoder, target, gpu.displaySize, cam, state.lines.appended)
}
