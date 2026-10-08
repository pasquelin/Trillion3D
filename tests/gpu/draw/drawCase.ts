// One case of the draw-compaction proof: its rows uploaded to the engine's compaction
// (`createGpuDraw`), compacted in a compute pass, then each indirect slot and the direct page drawn
// by the visibility raster in the same submission — no CPU readback or reorder between —, and what
// both left read back.
import { DRAW_ITEM_U32 } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts'
import type { GpuDraw } from '../../../packages/sdk-browser/src/gpu/draw/contract.ts'
import type { DrawItem } from '../../../packages/sdk-browser/src/gpu/draw/cpu.fixture.ts'
import { DIRECT_PAGE, HEIGHT, WIDTH, pageOfId, type setupVisibility } from './drawVisibility.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'

export interface DrawCase {
  name: string
  items: DrawItem[]
  /** The selection mask, one word per selection index; absent, every row is selected. */
  mask?: number[]
}

/** Words of the selection buffer ahead of the mask: the mask is read at an offset. */
const MASK_OFFSET = 11

/** The draw records as the card holds them, and each row's rest bit (`restBits`). */
function records(items: DrawItem[], cap: number) {
  const n = Math.min(items.length, cap),
    words = new Uint32Array(Math.max(1, n) * DRAW_ITEM_U32),
    rest = new Uint32Array(Math.max(1, ceilDiv(cap, 32)))
  for (const [i, item] of items.slice(0, n).entries()) {
    words.set(
      [item.pageIndex, item.bin, item.selectionIndex ?? 0, item.layer ?? 0, item.triangles ?? 0],
      i * DRAW_ITEM_U32,
    )
    if (item.rest) setBit(rest, i)
  }
  return { n, words, rest }
}

export async function runCase(
  device: GPUDevice,
  draw: GpuDraw,
  vis: ReturnType<typeof setupVisibility>,
  cap: number,
  { name, items, mask }: DrawCase,
) {
  const { n, words, rest } = records(items, cap)
  if (n) draw.uploadItems(words, 0, n - 1)
  device.queue.writeBuffer(draw.restBitsBuffer, 0, rest)
  let selection: { maskBuffer: GPUBuffer; maskOffset: number } | undefined
  if (mask) {
    const words = new Uint32Array(cap + MASK_OFFSET).fill(1)
    words.set(mask, MASK_OFFSET)
    const maskBuffer = device.createBuffer({
      size: words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(maskBuffer, 0, words)
    selection = { maskBuffer, maskOffset: MASK_OFFSET }
  }
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  draw.encode({ pass }, items.length, selection)
  pass.end()
  const { slots } = draw
  // Each indirect slot, then the direct page past them; the tested half reads the verdicts.
  for (let slot = 0; slot <= slots; slot++) {
    const render = encoder.beginRenderPass({
      colorAttachments: [
        { view: vis.views[slot], clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
        {
          view: vis.levelViews[slot],
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
    })
    render.setPipeline(vis.pipelines[slot >= slots / 2 && slot < slots ? 1 : 0])
    render.setBindGroup(0, vis.groups[slot])
    if (slot < slots) render.drawIndirect(draw.indirectBuffer, slot * 16)
    else render.draw(3, 1, 0, DIRECT_PAGE)
    render.end()
  }
  const readback = (bytes: number) =>
    device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
  const [instanceRead, commandRead, pixelRead] = [
    readback(cap * draw.perRow * 4),
    readback(slots * 16),
    readback(WIDTH * HEIGHT * 4 * (slots + 1)),
  ]
  encoder.copyBufferToBuffer(draw.instanceBuffer, 0, instanceRead, 0, cap * draw.perRow * 4)
  encoder.copyBufferToBuffer(draw.indirectBuffer, 0, commandRead, 0, slots * 16)
  encoder.copyTextureToBuffer(
    { texture: vis.target },
    { buffer: pixelRead, bytesPerRow: WIDTH * 4, rowsPerImage: HEIGHT },
    [WIDTH, HEIGHT, slots + 1],
  )
  device.queue.submit([encoder.finish()])
  await Promise.all([instanceRead, commandRead, pixelRead].map((b) => b.mapAsync(GPUMapMode.READ)))
  const commands = [...new Uint32Array(commandRead.getMappedRange())]
  const instanceCount = commands.reduce((sum, word, i) => sum + (i % 4 === 1 ? word : 0), 0)
  const instanceIds = [...new Uint32Array(instanceRead.getMappedRange(), 0, instanceCount)]
  const pixels = new Uint32Array(pixelRead.getMappedRange())
  const visiblePages = Array.from({ length: slots + 1 }, (_, slot) =>
    [...new Set(pixels.subarray(slot * WIDTH * HEIGHT, (slot + 1) * WIDTH * HEIGHT))]
      .filter((id) => id !== 0)
      .map(pageOfId)
      .sort((a, b) => a - b),
  )
  for (const buffer of [instanceRead, commandRead, pixelRead, selection?.maskBuffer])
    buffer?.destroy()
  return { name, instanceIds, commands, visiblePages }
}
