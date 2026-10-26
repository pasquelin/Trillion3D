import type { Outline } from '../../../../sdk-core/src/world/effect/outline.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { OUTLINE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { OUTLINE_FORMAT, outlineBytes } from './outline/outlineTarget.ts'
import {
  boundRect,
  chooseRoots,
  dropHeld,
  newHeld,
  scissor,
  writeOutlineUniform,
  type Held,
  type OutlineScan,
} from './outline/outlineHeld.ts'
import { createOutlinePrograms } from './outline/outlinePrograms.ts'
import type { OverlayFrame, WebgpuOverlayKind } from './webgpuKinds.ts'

type Programs = Awaited<ReturnType<typeof createOutlinePrograms>>

/** The scan target of the chain, its view and its group, with the size it was made at. */
type Scan = OutlineScan & {
  texture: GPUTexture | undefined
  view: GPUTextureView | undefined
  group: GPUBindGroup | undefined
}

/** The attachments the passes of every outline share, their views set per frame. */
type Attachments = {
  target: GPURenderPassColorAttachment
  display: GPURenderPassColorAttachment
  canvas: GPURenderPassColorAttachment
  scanned: GPURenderPassDescriptor
  lined: GPURenderPassDescriptor
  presented: GPURenderPassDescriptor
}

/** The attachments and the descriptors of the scan pass and of the two ways the line is laid. */
function createAttachments(): Attachments {
  // Cleared to past every reach: a pixel the scan's rectangle leaves out meets no selection.
  const target = {
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: { r: 1, g: 0, b: 0, a: 0 },
  } as GPURenderPassColorAttachment
  const display = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  const canvas = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
  return {
    target,
    display,
    canvas,
    scanned: { label: OUTLINE_PASS, colorAttachments: [target] },
    lined: { label: OUTLINE_PASS, colorAttachments: [display] },
    presented: { label: OUTLINE_PASS, colorAttachments: [display, canvas] },
  }
}

/** Frees the target and every hold: this image's commands may still name them, so they are
 *  retired, destroyed after the frame's submit. */
function releaseOutline(device: GPUDevice, scan: Scan, held: Held[], att: Attachments) {
  if (scan.texture) retire(device, scan.texture)
  held.forEach((h) => dropHeld(h, device))
  scan.texture = scan.view = scan.group = undefined
  att.target.view = att.display.view = att.canvas.view = undefined as unknown as GPUTextureView
  held.length = scan.width = scan.height = 0
}

/** Sizes the scan's target for a `w × h` display. */
function resizeScan(device: GPUDevice, programs: Programs, scan: Scan, w: number, h: number) {
  if (scan.texture) retire(device, scan.texture)
  scan.width = w
  scan.height = h
  scan.texture = device.createTexture({
    label: `${OUTLINE_PASS} scan`,
    size: { width: w, height: h },
    format: OUTLINE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  scan.view = scan.texture.createView()
  scan.group = device.createBindGroup({
    layout: programs.scan,
    entries: sequentialEntries([scan.view]),
  })
}

/** Points `h.group` at the frame's identifiers and the outline's own buffers, made again only
 *  when one of them moved. */
function bindSelection(device: GPUDevice, programs: Programs, h: Held, frame: OverlayFrame) {
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
  return h.group
}

/** Records the scan of the selection into the target, then the pass laying its line over the
 *  display image and the canvas; both scissored to `rect`. Returns the passes encoded. */
function encodeOutline(
  encoder: GPUCommandEncoder,
  programs: Programs,
  scan: Scan,
  view: GPUTextureView,
  scanGroup: GPUBindGroup,
  att: Attachments,
  group: GPUBindGroup,
  rect: Float64Array,
  grow: number,
  frame: OverlayFrame,
) {
  att.target.view = view
  const scanPass = encoder.beginRenderPass(att.scanned)
  scissor(scanPass, scan, rect, grow, 2 * grow)
  scanPass.setPipeline(programs.across)
  scanPass.setBindGroup(0, group)
  scanPass.draw(3)
  scanPass.end()
  att.display.view = frame.display
  if (frame.presentation) att.canvas.view = frame.presentation
  const pass = encoder.beginRenderPass(frame.presentation ? att.presented : att.lined)
  pass.setViewport(0, 0, scan.width, scan.height, 0, 1)
  scissor(pass, scan, rect, grow, grow)
  pass.setPipeline(frame.presentation ? programs.overPresent : programs.over)
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, scanGroup)
  pass.draw(3)
  pass.end()
  return 2
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
  // `taken` counts the selections taken: a rectangle follows the one it was taken from.
  const scan: Scan = {
    texture: undefined,
    view: undefined,
    group: undefined,
    width: 0,
    height: 0,
    taken: 0,
  }
  const held: Held[] = []
  const att = createAttachments()
  const release = () => releaseOutline(device, scan, held, att)
  return {
    /** Bytes of the scan's target as allocated; zero before the first `resize`. */
    get bytes() {
      return scan.texture ? outlineBytes(scan.width, scan.height) : 0
    },
    /** Sizes the scan's target for a `w × h` display; no outline frees everything. */
    resize(w: number, h: number, count: number) {
      if (!count || !w || !h) return release()
      if (held.length > count) held.splice(count).forEach((x) => dropHeld(x, device))
      if (w === scan.width && h === scan.height) return
      resizeScan(device, programs, scan, w, h)
    },
    /** Scans the selection of `outline`, the `nth` of the chain, across into the target, then lays
     *  its line over the display image and the canvas: two passes, scissored to the rectangle its
     *  roots may draw in (`boxRect`) grown by the line's reach — the scan down the column reads
     *  a reach above and below it —; none when its objects draw no root, or none on screen. The
     *  kind must be sized for it. */
    overlay(encoder, outline, nth, frame) {
      const { view, group } = scan
      if (!view || !group) return 0
      const h = (held[nth] ??= newHeld(device))
      if (!chooseRoots(device, scan, h, outline, frame)) return 0
      const rect = boundRect(scan, h, frame)
      if (!(rect[2] > rect[0] && rect[3] > rect[1])) return 0
      writeOutlineUniform(device, h, outline, frame)
      // One pixel more than the reach for the jitter the identifiers were drawn with.
      const grow = h.ints[9] + 2
      const selection = bindSelection(device, programs, h, frame)
      return encodeOutline(encoder, programs, scan, view, group, att, selection, rect, grow, frame)
    },
    dispose: () => release(),
  }
}
