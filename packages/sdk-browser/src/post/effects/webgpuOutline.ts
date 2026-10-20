import type { Outline } from '../../../../sdk-core/src/world/effect/outline.ts'
import { linearToSrgb } from '../../../../math/src/color/color.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { setBit } from '../../../../math/src/scalar/bits.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import { OUTLINE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { appendRootsUnder } from '../../frame/render/movedNode.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { OUTLINE_FORMAT, outlineBytes } from './outline/outlineTarget.ts'
import { boxRect, rootsBox } from './rootsRect.ts'
import { OUTLINE_UNIFORM_BYTES } from './outline/outlineWgsl.ts'
import { createOutlinePrograms } from './outline/outlinePrograms.ts'
import type { OverlayFrame, WebgpuOverlayKind } from './webgpuKinds.ts'

/** What one outline of the chain holds: its uniform, its chosen placements' bits and the group
 *  naming them with the frame's identifiers. Both buffers go up through `writeChanged`: only the
 *  words that differ from what they hold. */
type Held = {
  uniform: GPUBuffer
  /** The uniform's words, read as floats and, for the reach, as an integer. */
  values: Float32Array<ArrayBuffer>
  words: Uint32Array<ArrayBuffer>
  ints: Int32Array<ArrayBuffer>
  chosen: GPUBuffer | undefined
  /** One bit per root, and the ranks it sets: storage kept, grown only (`appendUnder`). */
  bits: Uint32Array<ArrayBuffer>
  ranks: number[]
  count: number
  /** What the bits were taken at: the list outlined, then the scene's and the resources'
   *  revisions, the roots' count and their index's revision. */
  objects: readonly Outline['objects'][number][] | undefined
  chosenAt: Float64Array
  /** The world box its roots may draw in (`rootsBox`), taken with the bits; whether they have
   *  one. The rectangle it projects to, and what that was taken at: the bits', then the view's
   *  revision and the display's size. */
  box: Float64Array
  bounded: boolean
  rect: Float64Array
  rectAt: Float64Array
  identity: WebgpuBindIdentity
  group: GPUBindGroup | undefined
}

/** Whether `at` holds `a`, `b`, `c`, `d`, which it holds from now on: a cache key's test, with
 *  no array made per frame. */
function keeps(at: Float64Array, a: number, b: number, c: number, d: number) {
  const same = at[0] === a && at[1] === b && at[2] === c && at[3] === d
  at[0] = a
  at[1] = b
  at[2] = c
  at[3] = d
  return same
}

/**
 * The WebGPU outline (`outline/outlineWgsl.ts`): one `OUTLINE_FORMAT` target at the display's size, which
 * every outline of the chain scans in turn, and two passes each. Before them, the roots the
 * outline's objects draw — each object's subtree, by the node each root draws (`rootSource`), in
 * the scene's own tree — become one bit per root, uploaded only when they change; a page row names
 * its root (`pages[row].placement`), so whatever cluster the cut draws of a selected root, at any
 * detail, is chosen. Nothing exists before the first outline with objects (an idle pass counts for
 * none, `countKinds`): the target follows the display, and is freed with the last.
 */
export async function createWebgpuOutline(device: GPUDevice): Promise<WebgpuOverlayKind<Outline>> {
  const programs = await createOutlinePrograms(device)
  let texture: GPUTexture | undefined,
    view: GPUTextureView | undefined,
    scanGroup: GPUBindGroup | undefined,
    width = 0,
    height = 0
  const held: Held[] = []
  // Counts the selections taken: a rectangle follows the one it was taken from.
  let taken = 0
  // Cleared to past every reach: a pixel the scan's rectangle leaves out meets no selection.
  const target = {
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: { r: 1, g: 0, b: 0, a: 0 },
  } as GPURenderPassColorAttachment
  const scanned = { label: OUTLINE_PASS, colorAttachments: [target] }
  const display = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const canvas = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const lined = { label: OUTLINE_PASS, colorAttachments: [display] }
  const presented = { label: OUTLINE_PASS, colorAttachments: [display, canvas] }
  const release = () => {
    // This image's commands may still name them: retired, destroyed after the frame's submit.
    if (texture) retire(device, texture)
    held.forEach(drop)
    texture = view = scanGroup = undefined
    target.view = display.view = canvas.view = undefined as unknown as GPUTextureView
    held.length = width = height = 0
  }
  const drop = ({ uniform, chosen }: Held) => {
    retire(device, uniform)
    if (chosen) retire(device, chosen)
  }
  const holdFor = (nth: number) => {
    if (held[nth]) return held[nth]
    const { f: values, u: words, i: ints } = wordViews(new ArrayBuffer(OUTLINE_UNIFORM_BYTES))
    return (held[nth] = {
      uniform: device.createBuffer({
        label: `${OUTLINE_PASS} uniform`,
        size: OUTLINE_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      values,
      words,
      ints,
      chosen: undefined,
      bits: new Uint32Array(1),
      ranks: [],
      count: 0,
      objects: undefined,
      chosenAt: new Float64Array(4).fill(Number.NaN),
      box: new Float64Array(6),
      bounded: false,
      rect: new Float64Array(4),
      rectAt: new Float64Array(4).fill(Number.NaN),
      identity: createWebgpuBindIdentity(),
      group: undefined,
    })
  }
  /** The bits of the roots `outline` chooses, uploaded where they changed (a buffer grown with
   *  the roots); how many roots it chooses. Taken again only when the list, the scene (a node
   *  moved or re-parented), the resources or the roots changed: a still selection, however large,
   *  costs one comparison a frame. */
  const choose = (h: Held, outline: Outline, frame: OverlayFrame) => {
    const { revisions, layout } = frame
    const roots = layout.selectionRoots.length
    const kept = keeps(
      h.chosenAt,
      revisions.scene,
      revisions.resources,
      roots,
      layout.rootIndex.revision,
    )
    if (kept && h.objects === outline.objects) return h.count
    h.objects = outline.objects
    taken++
    let count = 0
    for (const node of outline.objects) count = appendRootsUnder(layout, node, h.ranks, count)
    h.count = count
    const ranks = h.ranks
    const words = Math.max(1, bitWords(roots))
    if (h.bits.length < words) h.bits = new Uint32Array(words)
    h.bits.fill(0, 0, words)
    for (let k = 0; k < count; k++) setBit(h.bits, ranks[k])
    h.chosen = sizedBuffer(
      device,
      h.chosen,
      words * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      `${OUTLINE_PASS} chosen`,
    )
    writeChanged(device, h.chosen, h.bits, 0, words)
    h.bounded = rootsBox(h.box, layout.selectionRoots, ranks, count)
    return count
  }
  /** The rectangle the chosen roots may draw in (`boxRect`), projected again only when the
   *  selection, the view or the display changed. */
  const bound = (h: Held, frame: OverlayFrame) => {
    if (!keeps(h.rectAt, taken, frame.revisions.view, width, height))
      boxRect(h.rect, h.bounded ? h.box : undefined, frame.viewProj, width, height)
    return h.rect
  }
  /** The uniform of `outline` on `frame`, uploaded where it changed. */
  const write = (h: Held, outline: Outline, frame: OverlayFrame) => {
    const v = h.values,
      line = outline.thickness * frame.pixelRatio,
      { color } = outline
    v[0] = linearToSrgb(color.r)
    v[1] = linearToSrgb(color.g)
    v[2] = linearToSrgb(color.b)
    v[3] = 1
    v[4] = frame.idSize[0] / frame.size[0]
    v[5] = frame.idSize[1] / frame.size[1]
    v[6] = frame.idSize[0]
    v[7] = frame.idSize[1]
    v[8] = line
    h.ints[9] = Math.ceil(line)
    writeChanged(device, h.uniform, h.words, 0, 10)
  }
  /** Scissors `pass` to `rect` grown by `x` and `y` pixels, within the display. */
  const scissor = (pass: GPURenderPassEncoder, rect: Float64Array, x: number, y: number) => {
    const x0 = Math.max(0, rect[0] - x),
      y0 = Math.max(0, rect[1] - y)
    pass.setScissorRect(
      x0,
      y0,
      Math.min(width, rect[2] + x) - x0,
      Math.min(height, rect[3] + y) - y0,
    )
  }
  return {
    /** Bytes of the scan's target as allocated; zero before the first `resize`. */
    get bytes() {
      return texture ? outlineBytes(width, height) : 0
    },
    /** Sizes the scan's target for a `w × h` display; no outline frees everything. */
    resize(w: number, h: number, count: number) {
      if (!count || !w || !h) return release()
      if (held.length > count) held.splice(count).forEach(drop)
      if (w === width && h === height) return
      if (texture) retire(device, texture)
      width = w
      height = h
      texture = device.createTexture({
        label: `${OUTLINE_PASS} scan`,
        size: { width: w, height: h },
        format: OUTLINE_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
      view = texture.createView()
      scanGroup = device.createBindGroup({
        layout: programs.scan,
        entries: sequentialEntries([view]),
      })
    },
    /** Scans the selection of `outline`, the `nth` of the chain, across into the target, then lays
     *  its line over the display image and the canvas: two passes, scissored to the rectangle its
     *  roots may draw in (`boxRect`) grown by the line's reach — the scan down the column reads
     *  a reach above and below it —; none when its objects draw no root, or none on screen. The
     *  kind must be sized for it. */
    overlay(encoder, outline, nth, frame) {
      if (!view || !scanGroup) return 0
      const h = holdFor(nth)
      if (!choose(h, outline, frame)) return 0
      const rect = bound(h, frame)
      if (!(rect[2] > rect[0] && rect[3] > rect[1])) return 0
      write(h, outline, frame)
      // One pixel more than the reach for the jitter the identifiers were drawn with.
      const grow = h.ints[9] + 2
      const next = h.identity.next
      next[0] = frame.ids
      next[1] = frame.pages
      next[2] = h.chosen
      next[3] = h.uniform
      next.length = 4
      if (h.identity.moved() || !h.group)
        h.group = device.createBindGroup({
          layout: programs.selection,
          entries: sequentialEntries([
            frame.ids,
            { buffer: frame.pages },
            { buffer: h.chosen! },
            { buffer: h.uniform },
          ]),
        })
      target.view = view
      const scan = encoder.beginRenderPass(scanned)
      scissor(scan, rect, grow, 2 * grow)
      scan.setPipeline(programs.across)
      scan.setBindGroup(0, h.group)
      scan.draw(3)
      scan.end()
      display.view = frame.display
      if (frame.presentation) canvas.view = frame.presentation
      const pass = encoder.beginRenderPass(frame.presentation ? presented : lined)
      pass.setViewport(0, 0, width, height, 0, 1)
      scissor(pass, rect, grow, grow)
      pass.setPipeline(frame.presentation ? programs.overPresent : programs.over)
      pass.setBindGroup(0, h.group)
      pass.setBindGroup(1, scanGroup)
      pass.draw(3)
      pass.end()
      return 2
    },
    dispose: () => release(),
  }
}
