import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { bufferEntry, resourceEntry } from '../../gpu/bind/liveEntries.ts'
import { shadeBindEntries } from '../../gpu/bind/bindEntries.ts'
import { shadeResources } from '../../gpu/bind/shadeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { computeTextureEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { rowsMoved, rowsUnread } from '../../geometry/rows/dirty.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { shadeLayoutEntries } from '../passes/shadeLayout.ts'
import { SHADE_UNIFORM } from '../shader/uniformLayout.ts'
import { PAGE_INFO } from '../pageInfo.ts'
import { FLAG_DISPLACED, ROW_WORDS } from '../types.ts'
import { DISPLACED_SHADE_BINDINGS, PRISM_UNIFORM } from './prismWgsl.ts'
import { UNTESSELLATED } from './rowWgsl.ts'
import { tessellationWanted } from './wanted.ts'

/**
 * The resolve's side of a displaced pixel (`prismWgsl.ts`): which classes draw one, the group 0 their
 * pipelines read — the resolve's, plus the depth the visibility buffer resolved to and the view's
 * numbers — and what it holds each image. A scene that tessellates nothing has none of it: no key,
 * no group, no buffer.
 */

/** The group 0 of the classes that draw a displaced pixel: the resolve's entries, then the depth
 *  and `PrismUni`. */
export const displacedShadeLayout = oncePerDevice((device) =>
  device.createBindGroupLayout({
    entries: [
      ...shadeLayoutEntries(),
      computeTextureEntry(DISPLACED_SHADE_BINDINGS.depth, 'depth', '2d'),
      computeUniformEntry(DISPLACED_SHADE_BINDINGS.prism, {
        minBindingSize: PRISM_UNIFORM.words * 4,
      }),
    ],
  }),
)

/** What a runtime holds of the displaced pixels: the keys of its rows, the rows they were read
 *  from, the buffer of the view's numbers and the group, each made when first needed. */
type Held = {
  keys: number[]
  read: ReturnType<typeof rowsUnread>
  uniform?: GPUBuffer
  identity: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
}
const held = new WeakMap<object, Held>()
const heldOf = (rt: WebgpuPagesRuntime) => {
  let h = held.get(rt.vis)
  if (!h)
    held.set(rt.vis, (h = { keys: [], read: rowsUnread(), identity: createWebgpuBindIdentity() }))
  return h
}

/**
 * The class keys of the rows the image tessellates — displaced, and none of the rows the
 * tessellation leaves as they are (`UNTESSELLATED`) —, empty while the image
 * tessellates nothing: those classes shade through the displaced pipelines. The rows are walked
 * again only when one was written since (`rowsMoved`).
 */
export function displacedKeys(rt: WebgpuPagesRuntime): readonly number[] {
  const h = heldOf(rt),
    { rows } = rt.layout
  if (!tessellationWanted(rt) || !rows.pageTableInts) return NONE
  if (!rowsMoved(h.read, rows.pageTableInts, rows.packedCount, rows.rowWrites)) return h.keys
  h.keys.length = 0
  const at = PAGE_INFO.at
  for (let row = 0; row < rows.packedCount; row++) {
    const base = row * ROW_WORDS,
      flags = rows.pageTableInts[base + at.flags]!
    // The same test as the shader's (`tessellatedFlags`).
    if (!(flags & FLAG_DISPLACED) || flags & UNTESSELLATED) continue
    const key = rows.pageTableInts[base + at.materialClass]!
    if (!h.keys.includes(key)) h.keys.push(key)
  }
  return h.keys
}
const NONE: readonly number[] = []

/** Asks, off the frame, the displaced pipelines of the classes the image tessellates, and answers
 *  whether they are all compiled: the frame is held on them (`PreparedPipeline.ask`). */
export function askDisplacedClasses(rt: WebgpuPagesRuntime) {
  const classes = rt.vis.shadeClasses
  let ready = true
  if (classes)
    for (const key of displacedKeys(rt)) ready = classes.displaced(key).ask().ready && ready
  return ready
}

/** The view's numbers, in a buffer made at the first image that needs them and written at each:
 *  the inverse of the resolve's `viewProj` — the matrix the shade uniform holds, jitter included —,
 *  the eye, whether the frame tessellated and the pixels it draws. */
function writePrism(rt: WebgpuPagesRuntime, device: GPUDevice, h: Held) {
  const bytes = ceilDiv(PRISM_UNIFORM.words, 4) * 16
  const buffer = (h.uniform ??= device.createBuffer({
    label: 'Trillion3D displaced resolve',
    size: bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  const words = new Float32Array(PRISM_UNIFORM.words),
    ints = new Uint32Array(words.buffer),
    at = PRISM_UNIFORM.at
  const view = rt.vis.shadeUniPacked.subarray(
    SHADE_UNIFORM.at.viewProj,
    SHADE_UNIFORM.at.viewProj + 16,
  )
  words.set(invertMatrix4(new Float64Array(16), view), at.invViewProj)
  words.set(rt.run.gate.cam.eye, at.eye)
  ints[at.tessellation] = 1
  words.set(rt.gpu.targetSize, at.viewport)
  device.queue.writeBuffer(buffer, 0, words)
  return buffer
}

/**
 * The group 0 of the displaced classes for this image: the resolve's own entries — read live, as the
 * resolve's group reads them — and the two it adds, made again only when a resource moved. Its
 * buffer is written first: the classes read it in this image's material pass.
 */
export function displacedGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const h = heldOf(rt),
    layout = displacedShadeLayout(device)
  writePrism(rt, device, h)
  const entries = (h.identity.entries[0] ??= [
    ...shadeBindEntries(shadeResources(rt)),
    resourceEntry(DISPLACED_SHADE_BINDINGS.depth, () => rt.gpu.depthView),
    bufferEntry(DISPLACED_SHADE_BINDINGS.prism, () => h.uniform),
  ])
  if (h.identity.entriesMoved(layout)) h.group = undefined
  return (h.group ??= device.createBindGroup({ layout, entries }))
}
