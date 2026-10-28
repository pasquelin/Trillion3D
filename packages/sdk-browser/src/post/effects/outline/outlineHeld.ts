import type { Outline } from '../../../../../sdk-core/src/world/effect/outline.ts'
import { linearToSrgb } from '../../../../../math/src/color/color.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { bitWords } from '../../../../../math/src/scalar/integers.ts'
import { setBit } from '../../../../../math/src/scalar/bits.ts'
import { sizedBuffer } from '../../../gpu/core/sizedBuffer.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { OUTLINE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { appendRootsUnder } from '../../../frame/render/movedNode.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../../gpu/bind/bindIdentity.ts'
import { boxRect, rootsBox } from '../rootsRect.ts'
import { OUTLINE_UNIFORM_BYTES } from './outlineWgsl.ts'
import type { OverlayFrame } from '../webgpuKinds.ts'
import { uniformBuffer } from '../../../gpu/core/uniformBlock.ts'

/** The scan target's size and the count of selections taken: a rectangle follows the selection
 *  it was taken from. */
export type OutlineScan = { width: number; height: number; taken: number }

/** What one outline of the chain holds: its uniform, its chosen placements' bits and the group
 *  naming them with the frame's identifiers. Both buffers go up through `writeChanged`: only the
 *  words that differ from what they hold. */
export type Held = {
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

/** A new, empty hold for one outline of the chain. */
export function newHeld(device: GPUDevice): Held {
  const { f: values, u: words, i: ints } = wordViews(new ArrayBuffer(OUTLINE_UNIFORM_BYTES))
  return {
    uniform: uniformBuffer(device, `${OUTLINE_PASS} uniform`, OUTLINE_UNIFORM_BYTES),
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
  }
}

/** Retires the buffers of `held`: this image's commands may still name them. */
export function dropHeld({ uniform, chosen }: Held, device: GPUDevice) {
  retire(device, uniform)
  if (chosen) retire(device, chosen)
}

/** The bits of the roots `outline` chooses, uploaded where they changed (a buffer grown with
 *  the roots); how many roots it chooses. Taken again only when the list, the scene (a node
 *  moved or re-parented), the resources or the roots changed: a still selection, however large,
 *  costs one comparison a frame. */
export function chooseRoots(
  device: GPUDevice,
  scan: OutlineScan,
  h: Held,
  outline: Outline,
  frame: OverlayFrame,
) {
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
  scan.taken++
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
export function boundRect(scan: OutlineScan, h: Held, frame: OverlayFrame) {
  const { width, height } = scan
  if (!keeps(h.rectAt, scan.taken, frame.revisions.view, width, height))
    boxRect(h.rect, h.bounded ? h.box : undefined, frame.viewProj, width, height)
  return h.rect
}

/** The uniform of `outline` on `frame`, uploaded where it changed. */
export function writeOutlineUniform(
  device: GPUDevice,
  h: Held,
  outline: Outline,
  frame: OverlayFrame,
) {
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
export function scissor(
  pass: GPURenderPassEncoder,
  scan: OutlineScan,
  rect: Float64Array,
  x: number,
  y: number,
) {
  const x0 = Math.max(0, rect[0] - x),
    y0 = Math.max(0, rect[1] - y)
  pass.setScissorRect(
    x0,
    y0,
    Math.min(scan.width, rect[2] + x) - x0,
    Math.min(scan.height, rect[3] + y) - y0,
  )
}
