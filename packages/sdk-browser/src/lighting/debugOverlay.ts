import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { composeGroup, heldGroup } from '../gpu/bind/bindIdentity.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { createTextOverlay, TEXT_LINE } from '../diagnostic/textOverlay.ts'
import { DEBUG_COLORS } from '../hair/debugLines.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { chainReady, type PreparedPipeline } from './deferred/fullscreen.ts'
import {
  clipOverlay,
  layOverlay,
  overlayGroup,
  overlayReady,
  type OverlayRect,
} from './overlayBlit.ts'

/** The pixel the figures start at. */
const TEXT_LEFT = 50
const TEXT_TOP = 100
/** The figures' names, padded to one column. */
const NAME_WIDTH = 18

/** How the reference names the formats an atlas is made in, for the figures' `Atlas format` row. */
const FORMAT_NAMES: Partial<Record<GPUTextureFormat, string>> = {
  r16float: 'PF_R16',
  rg11b10ufloat: 'PF_FloatR11G11B10',
  rgba16float: 'PF_FloatRGBA',
}

/** The reference's name for `format`: the format's own where it has none. */
export const atlasFormatName = (format: GPUTextureFormat) => FORMAT_NAMES[format] ?? format

/** One figure of a view: its name, its text and the colour it is written in. */
export type OverlayRow = readonly [name: string, value: string, colour: number]

/** The colour the on/off figures are written in: green for on, red for off. */
export const switchColour = (on: boolean) => (on ? DEBUG_COLORS.green : DEBUG_COLORS.red)

/** What a view hands the overlay once its pipelines are ready: the figures and the bindings its compute pass reads, none where the picture is
 *  not shown (`OverlayContext.shown`). The bindings should be the same objects from one image to the next while the resources are the same
 *  (`upload` and `picture` give them so): the pass keeps its bind group until one changes. */
export interface OverlayContent {
  readonly rows: readonly OverlayRow[]
  readonly entries?: readonly GPUBindGroupEntry[]
}

/** What a view's callback is given: the display's size, `picture`, which gives the texture its pass draws into (its last binding) for the
 *  pixels `rect` of the display — a texture of that size, made again only when the size changes, the pass dispatched over it alone —, and
 *  `shown`, whether the display holds any pixel of a rectangle (the picture of one it does not hold is not drawn, nor its bindings needed),
 *  and `upload`, which writes `data` into the buffer kept under `key` (made, or grown, as `data` needs; written only where `data` changed) and
 *  returns it as a binding, the same object while the buffer is. A rectangle the display holds in part is drawn, and its texture made, for that part. */
export interface OverlayContext {
  readonly width: number
  readonly height: number
  shown(rect: OverlayRect): boolean
  picture(rect: OverlayRect): GPUTextureView
  upload(
    key: string,
    usage: GPUBufferUsageFlags,
    data: Uint32Array<ArrayBuffer>,
  ): GPUBindingResource
}

/** A buffer a view reads: its binding, handed out again while the buffer is. */
interface HeldBuffer {
  readonly buffer: GPUBuffer
  readonly binding: { readonly buffer: GPUBuffer }
}

/** What the view keeps of a runtime: the text, the texture the atlas is drawn into with its view and the bindings that lay it over the image, the buffers it
 *  reads, and the bind group of its compute pass with what it names. */
interface OverlayState {
  readonly text: ReturnType<typeof createTextOverlay>
  readonly buffers: Map<string, HeldBuffer>
  texture?: GPUTexture
  view?: GPUTextureView
  group?: GPUBindGroup
  readonly compute: ReturnType<typeof heldGroup>
}

/**
 * The shared body of the atlas debug views: the figures as text, then the atlas drawn (a compute pass, `program`, entry `mainCs`, writing a texture
 * of the picture's size that is the last binding of its group, dispatched over it alone) and laid over the image there. Each view supplies its pass and its content; this owns
 * the per-runtime state, the texture, the buffers (kept, grown when the data outgrows them), the readiness check and the text.
 */
export function createDebugOverlay(options: {
  label: string
  blitLabel: string
  program: (device: GPUDevice) => PreparedPipeline<GPUComputePipeline>
}) {
  const states = new WeakMap<object, OverlayState>()

  /** Gives the view's resources back. */
  function dispose(owner: WebgpuPagesRuntime) {
    const state = states.get(owner)
    const { device } = owner.gpu
    state?.text.dispose()
    if (state && device) {
      if (state.texture) retire(device, state.texture)
      for (const held of state.buffers.values()) retire(device, held.buffer)
    }
    states.delete(owner)
  }

  return {
    dispose,
    /** Draws the view over the display image, once its pipelines are compiled; nothing, nothing made, while they are not. */
    encode(
      rt: WebgpuPagesRuntime,
      device: GPUDevice,
      encoder: GPUCommandEncoder,
      cam: EngineCamera,
      content: (context: OverlayContext) => OverlayContent,
    ) {
      const { gpu } = rt
      const target = gpu.displayView
      if (!target) return
      const computeReady = chainReady(options.program(device))
      if (!overlayReady(device) || !computeReady) return
      const state: OverlayState = states.get(rt) ?? {
        text: createTextOverlay(device),
        buffers: new Map(),
        compute: heldGroup(),
      }
      states.set(rt, state)
      const [width, height] = gpu.displaySize
      let rect: OverlayRect | undefined
      const { rows, entries } = content({
        width,
        height,
        shown: (at) => !!clipOverlay(at, gpu.displaySize),
        picture(at) {
          rect = clipOverlay(at, gpu.displaySize)
          // A rectangle the display holds nothing of keeps a texel, bound by the view that does not use it.
          const w = rect?.width ?? 1
          const h = rect?.height ?? 1
          if (state.texture?.width !== w || state.texture.height !== h) {
            if (state.texture) retire(device, state.texture)
            state.texture = device.createTexture({
              label: options.label,
              size: [w, h],
              format: 'rgba8unorm',
              usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            })
            state.view = state.texture.createView()
            state.group = overlayGroup(device, state.view)
          }
          return state.view!
        },
        upload(key, usage, data) {
          const size = Math.max(16, data.byteLength)
          let held = state.buffers.get(key)
          if (!held || held.buffer.size < size) {
            if (held) retire(device, held.buffer)
            const buffer = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST })
            held = { buffer, binding: { buffer } }
            state.buffers.set(key, held)
          }
          writeChanged(device, held.buffer, data, 0, data.length)
          return held.binding
        },
      })
      // The atlas, drawn over the pixels of its picture alone and laid there; nothing where the display holds none of them.
      if (rect && entries && state.group) {
        const compute = options.program(device).get()!
        // The group is made again only where the pipeline or a resource the view binds moved.
        state.compute.identity.entries[0] = entries as GPUBindGroupEntry[]
        composeGroup(device, state.compute, compute)
        const pass = encoder.beginComputePass({ label: options.label })
        pass.setPipeline(compute)
        pass.setBindGroup(0, state.compute.group!)
        pass.dispatchWorkgroups(ceilDiv(rect.width, 8), ceilDiv(rect.height, 8))
        pass.end()
        layOverlay(device, encoder, options.blitLabel, target, state.group, rect, gpu.displaySize)
      }
      // The figures, as text over the picture.
      state.text.begin(cam)
      rows.forEach(([name, value, colour], at) => {
        const y = TEXT_TOP + at * TEXT_LINE
        state.text.lines.text(name.padEnd(NAME_WIDTH), TEXT_LEFT, y, DEBUG_COLORS.silver)
        state.text.lines.text(value, TEXT_LEFT + (NAME_WIDTH + 1) * 8, y, colour)
      })
      state.text.encode(encoder, target, gpu.displaySize, cam)
    },
  }
}
