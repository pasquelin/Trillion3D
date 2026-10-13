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
import { rootOf, rootOfPacked } from '../page/selection/placements.ts'
import { ROW_INPUT_DOUBLES, packInputs, rowInputs } from './composedRowPack.ts'

/** Words of a row's inputs, packed. */
const ROW_INPUT_WORDS = ROW_INPUT_DOUBLES * 2
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

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
