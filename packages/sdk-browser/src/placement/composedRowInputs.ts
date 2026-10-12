/**
 * WHAT THE COMPOSE ROWS PASS DERIVES A ROW'S WORLD-DEPENDENT WORDS FROM, kept beside the rows
 * (`gpuCompose.ts`). A parent that moves a root moves every word a row derives from its world: the
 * world sphere the shadow cull drops it by, the eight corners the Hi-Z test projects, the detail
 * the shadows' levels are judged by. Each is made of the root's world and of what the world does not
 * change — the page's box and sphere, its errors, its reach, the cut rule's residency —, and the
 * second is what a row's inputs hold: twenty-four doubles, written when the row is, read by the GPU
 * every frame a parent moves its root. The CPU writes each of those words from the same inputs when
 * it writes the row (`writeClusterSphere`, `packPageCorners`, `writeRowLod`); the GPU's are the same
 * words (`gpuComposeDerivedWgsl.ts`).
 */
import { boxCenter } from '../../../math/src/geometry/box.ts'
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { rowBox, rowGrowth } from '../hiz/corners.ts'
import { rootOf, rootOfPacked } from '../page/selection/placements.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { LOD_FLAGS, ROW_LOD_INPUT_DOUBLES, rowLodInputs } from '../webgpu/shadow/rowLodWords.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { Placements } from '../page/selection/placements.ts'

/** A row's inputs: its local box's centre and half extent grown by the reach (the sphere), its box
 *  grown by it (the corners), then the detail's. */
export const ROW_INPUT_DOUBLES = 12 + ROW_LOD_INPUT_DOUBLES
/** Where each part lies, in doubles. */
export const INPUT_CENTRE = 0,
  INPUT_HALF = 3,
  INPUT_MIN = 6,
  INPUT_MAX = 9,
  INPUT_LOD = 12
const ROW_INPUT_WORDS = ROW_INPUT_DOUBLES * 2

/**
 * Row inputs `rec` of a root `root`, into `into` from `o`; the zero inputs for a row with no record.
 * `lod` false leaves the detail out — a blended caster's row has none.
 */
export function rowInputs(
  into: Float64Array,
  o: number,
  rec: PageRec | undefined,
  root: (Placements[number] & { readonly worldBox?: ArrayLike<number> }) | undefined,
  ready: boolean,
  childReady: boolean,
  lod = true,
) {
  into.fill(0, o, o + ROW_INPUT_DOUBLES)
  if (!rec || !root) return
  const { min, max } = rowBox(rec),
    reach = rowGrowth(rec, root.reach)
  boxCenter(into, o + INPUT_CENTRE, min[0], min[1], min[2], max[0], max[1], max[2])
  for (let axis = 0; axis < 3; axis++) {
    into[o + INPUT_HALF + axis] = (max[axis] - min[axis]) / 2 + reach
    into[o + INPUT_MIN + axis] = min[axis] - reach
    into[o + INPUT_MAX + axis] = max[axis] + reach
  }
  if (lod) rowLodInputs(into, o + INPUT_LOD, rec, root, ready, childReady)
}

/** The inputs `scratch` holds, packed at word `base` of `out` as the GPU reads them: each double two
 *  words, but the detail's bits one word, which the shader reads as an integer. */
export function packInputs(out: Uint32Array, base: number, scratch: Float64Array) {
  packDoubles(out, base, scratch)
  const flags = (INPUT_LOD + LOD_FLAGS) * 2
  out[base + flags] = scratch[INPUT_LOD + LOD_FLAGS]
  out[base + flags + 1] = 0
}

/** The inputs of rows `[from, to]` of the table, packed as the GPU reads them: each double two
 *  words, but the detail's bits one word, which the shader reads as an integer. */
function packRowInputs(
  rt: WebgpuPagesRuntime,
  out: Uint32Array,
  scratch: Float64Array,
  from: number,
  to: number,
) {
  const { rows, selectionRoots, placement } = rt.layout,
    selection = rt.run.gpuSelection
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row],
      page = rows.packedPageIndex[row],
      base = row * ROW_INPUT_WORDS
    const root = rec && rootOf(selectionRoots, rootOfPacked(placement, page))
    rowInputs(
      scratch,
      0,
      rec,
      root,
      (rec && selection?.isReady(page)) ?? true,
      (rec && selection?.isChildReady(page)) ?? true,
      row < rows.blendFirst,
    )
    packInputs(out, base, scratch)
  }
}

/** The inputs of the table, kept once a parent composes rows: every row written when they are
 *  made, then the rows each frame's dirty marks name (`uploadComposedRowInputs`). Undefined while
 *  none does. */
export function composedRowInputs(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state?.parentIds.size) return undefined
  const rows = rt.layout.rows.rowCount
  if (state.inputs?.rows === rows) return state.inputs
  state.inputs?.buffer.destroy()
  const packed = new Uint32Array(Math.max(1, rows) * ROW_INPUT_WORDS)
  const buffer = device.createBuffer({
    label: 'Trillion3D composed row inputs',
    size: packed.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  state.inputs = { buffer, packed, rows, scratch: new Float64Array(ROW_INPUT_DOUBLES) }
  if (rows > 0) sendRun(rt, device, 0, rows - 1)
  return state.inputs
}

function sendRun(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const inputs = rt.compose!.inputs!
  packRowInputs(rt, inputs.packed, inputs.scratch, from, to)
  device.queue.writeBuffer(
    inputs.buffer,
    from * ROW_INPUT_WORDS * 4,
    inputs.packed,
    from * ROW_INPUT_WORDS,
    (to - from + 1) * ROW_INPUT_WORDS,
  )
}

/** The inputs of the rows the table declared dirty, run by run, in the window of the image in which
 *  they are written (`followRows`): a row written, a page that arrived or left, a readiness that
 *  moved. Every row once when the buffer is made. */
export function uploadComposedRowInputs(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose
  if (!state?.parentIds.size) return
  const had = state.inputs?.rows === rt.layout.rows.rowCount
  if (!composedRowInputs(rt, device) || !had) return
  rt.layout.rows.forEachDirtyRun(
    rt,
    (_, from, to) => sendRun(rt, device, from, to),
    state.inputs!.rows - 1,
  )
}
