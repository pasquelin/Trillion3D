/**
 * THE PER-LIGHT PATH (`shadowOnePassProjection` false), host side. The shadowed local lights leave the
 * one-pass projection and the batched light loop: each is lit alone, after the batched lights, from a
 * screen mask of its own. For each light, in the order of the frame's projection records:
 *   1. the light is projected over the pixels it reaches (`perLightProjectionWgsl.ts`) into its layer of the
 *      mask, which the projection writes whole over that rectangle: no clear precedes it
 *      (`shadowForcePerLightMaskClear` clears the layer to 0 first);
 *   2. the light is drawn reading its layer (`../../../deferred/perLightProgram.ts`).
 * The first is this file's (`PerLightLights.encodeMask`); the lighting calls it between its draws. The mask is
 * an array of `PER_LIGHT_MASK_LAYERS` layers at most (`VsmMask.perLight`), light `i` writing layer
 * `i % layers`, at the targets' size, the pixels a light reaches (`perLightScissor.ts`) the only ones its
 * steps touch. A frame of at most as many lights as layers keeps its masks: where the projection is held
 * (`vsmProjectionHold.ts`) and the masks stand, no light is traced again (`PerLightFrame.stale`).
 */
import { vsmPerFrameSet, type VsmResources } from '../resources.ts'
import { VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { chainReady } from '../../../deferred/fullscreen.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { writeChangedSlots } from '../../../../gpu/core/writeChanged.ts'
import { sizedBuffer } from '../../../../gpu/core/sizedBuffer.ts'
import type { VsmPerLightMask } from '../frame/vsmMask.ts'
import { perLightPipelinesOf } from './perLightPipelines.ts'
import { projectedLightRect } from './perLightScissor.ts'
import {
  PER_LIGHT_RECORD_AT,
  PER_LIGHT_RECORD_BINDING_BYTES,
  PER_LIGHT_RECORD_WORDS,
  perLightStride,
  recordOffset,
} from './perLightRecord.ts'
import { passGroupFor } from './projectionPass.ts'
import type { VsmProjectionFrame, VsmProjectionSource } from './projectionPass.ts'
import { sunCount } from './projectionView.ts'
import { pipelinesFor, tablesGroup } from './projectionPipelines.ts'
import { vsmPerLightState, vsmProjectionReserve } from './projectionStore.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

const PASS = `${VSM_PASS_PREFIX}projection.perLight`
const CLEAR_LAYER: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'clear',
  storeOp: 'store',
  clearValue: [0, 0, 0, 0],
}
const CLEAR: GPURenderPassDescriptor = { label: `${PASS}.clear`, colorAttachments: [CLEAR_LAYER] }
const PROJECT: GPUComputePassDescriptor = { label: `${PASS}.project` }

/** The shadowed local lights of a frame the lighting lights one by one, and what lights them. */
export interface PerLightLights {
  /** The lights, in the order of the frame's projection records; only those that reach a pixel. */
  readonly count: number
  /** The lights' records (`perLightRecord.ts`), light `i`'s at `i × stride`, read at that dynamic offset. */
  readonly records: GPUBuffer
  readonly stride: number
  /** The words of the records as integers, `strideWords` a record: light `i`'s rectangle (the first column and row, one past the
   *  last column and row) at `i × strideWords + PER_LIGHT_RECORD_AT.rect`. */
  readonly ints: Int32Array
  readonly strideWords: number
  /** The byte offset of each light's record (`i × stride`), which the dispatch and the draw bind at. */
  readonly offsets: Uint32Array
  /** The mask the lights write in turn and their draws read: its array view. */
  readonly mask: GPUTextureView
  /** Whether the pipelines of the steps are compiled; the frames wait for them otherwise
   *  (`chainReady`). */
  ready(): boolean
  /** Encodes light `i`'s projection into its layer of the mask, unless the layers hold it already. */
  encodeMask(encoder: GPUCommandEncoder, i: number): void
  /** The layers hold nothing of these lights' masks: the projection ran, or is not held (`vsmProjectionHold.ts`). Their masks are
   *  encoded at the lighting, and the layers stand again from the last of them. */
  markStale(): void
}

/** What a frame's per-light lights are made from. */
interface PerLightInputs {
  device: GPUDevice
  res: VsmResources
  frame: VsmProjectionFrame
  source: VsmProjectionSource
  /** The mask the lights write (`ensureMask`). */
  mask: VsmPerLightMask
  /** The ranks, in the light buffer, of the frame's lights, indexed as `frame.lights`: those past the suns are read. */
  ranks: ArrayLike<number>
  /** `shadowForcePerLightMaskClear`. */
  forceClear: boolean
}

/** The pass's frame: one object a session, rewritten each frame (`beginPerLightFrame`). */
class PerLightFrame implements PerLightLights {
  count = 0
  records!: GPUBuffer
  stride = 0
  strideWords = 0
  ints = new Int32Array(0)
  offsets = new Uint32Array(0)
  mask!: GPUTextureView
  inputs!: PerLightInputs
  /** Whether the layers do not hold the masks of the lights' last frame: set where the projection ran or is not held, until every
   *  light's mask has been encoded. */
  private stale = true

  markStale() {
    this.stale = true
  }

  /** Fills the records of the lights of `inputs` that reach a pixel; the lights that do not are left out. */
  begin(inputs: PerLightInputs, state: ReturnType<typeof vsmPerLightState>, strideWords: number) {
    const { frame, ranks, mask } = inputs
    const { camera, lights } = frame
    const { ints } = state
    let count = 0
    for (let k = sunCount(lights); k < lights.length; k++) {
      const light = lights[k]
      // The suns come first (`sunCount`): every light past them is a local one, with a position and a reach.
      if (light.type === 'directional') continue
      const at = count * strideWords
      if (
        !projectedLightRect(
          ints,
          at + PER_LIGHT_RECORD_AT.rect,
          light.position,
          light.radius,
          camera.view,
          camera.projection,
          camera.perspective,
          frame.width,
          frame.height,
        )
      )
        continue
      ints[at + PER_LIGHT_RECORD_AT.record] = k
      ints[at + PER_LIGHT_RECORD_AT.rank] = ranks[k]
      ints[at + PER_LIGHT_RECORD_AT.layer] = count % mask.layers.length
      state.offsets[count] = count * strideWords * 4
      count++
    }
    this.count = count
    this.inputs = inputs
    this.records = state.records!
    this.ints = ints
    this.offsets = state.offsets
    this.strideWords = strideWords
    this.stride = strideWords * 4
    this.mask = mask.view
  }

  ready() {
    const { device, res } = this.inputs
    return chainReady(perLightPipelinesOf(pipelinesFor(device, res.layout)).projection)
  }

  encodeMask(encoder: GPUCommandEncoder, i: number) {
    const { device, res, frame, source, mask, forceClear } = this.inputs
    // A frame of no more lights than layers finds each light's mask where the last frame left it.
    if (!this.stale && this.count <= mask.layers.length) return
    const state = vsmProjectionReserve(device, res)
    const held = vsmPerLightState(state)
    const p = pipelinesFor(device, res.layout)
    const pipes = perLightPipelinesOf(p)
    const projection = pipes.projection.get()
    if (!projection) return
    if (forceClear) {
      CLEAR_LAYER.view = mask.layers[i % mask.layers.length]
      encoder.beginRenderPass(CLEAR).end()
    }
    const at = i * this.strideWords + PER_LIGHT_RECORD_AT.rect
    const [x0, y0, x1, y1] = [
      this.ints[at],
      this.ints[at + 1],
      this.ints[at + 2],
      this.ints[at + 3],
    ]
    const compute = encoder.beginComputePass(PROJECT)
    compute.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout))
    compute.setPipeline(projection)
    compute.setBindGroup(
      1,
      passGroupFor(
        device,
        state,
        held.projection,
        pipes.projectionLayout,
        frame.hizDepth,
        source,
        mask.view,
        { perLight: this.records },
      ),
      recordOffset(this.offsets, i),
    )
    compute.dispatchWorkgroups(
      ceilDiv(x1 - x0, VSM_PROJECTION_GROUP_SIZE),
      ceilDiv(y1 - y0, VSM_PROJECTION_GROUP_SIZE),
      1,
    )
    compute.end()
    // The last light's mask encoded: the layers hold the frame's.
    if (i === this.count - 1) this.stale = false
  }
}

/** The pass's frame of the set of `res`, kept on it. */
const frames = new WeakMap<VsmResources, PerLightFrame>()

/**
 * Lays out the frame's per-light lights from `inputs` and uploads their records: the lights past the suns
 * of `inputs.frame` that reach a pixel, in order. The frame's `PerLightLights` — kept on the set, held
 * by the lighting for the frame's draws (`vsmPerLight`) — none where no light reaches one.
 */
export function beginPerLightFrame(inputs: PerLightInputs): PerLightLights | undefined {
  const { device, res } = inputs
  const state = vsmProjectionReserve(device, res)
  const held = vsmPerLightState(state)
  const lights = inputs.frame.lights.length
  const stride = perLightStride(device)
  const strideWords = stride / 4
  if (held.words.length < lights * strideWords) {
    held.words = new Uint32Array(Math.max(1, lights) * strideWords)
    held.ints = new Int32Array(held.words.buffer)
    held.offsets = new Uint32Array(Math.max(1, lights))
  }
  held.records = sizedBuffer(
    device,
    held.records,
    Math.max(lights * stride, PER_LIGHT_RECORD_BINDING_BYTES),
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    'vsm.projection.perLight.records',
  )
  let frame = frames.get(res)
  if (!frame) frames.set(res, (frame = new PerLightFrame()))
  frame.begin(inputs, held, strideWords)
  held.frame = frame.count ? frame : undefined
  // Only the words a record uses are compared: a light that did not move sends nothing.
  writeChangedSlots(device, held.records, held.words, {
    count: frame.count,
    words: PER_LIGHT_RECORD_WORDS,
    strideWords,
  })
  return frame.count ? frame : undefined
}
