import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaResolves, resolveTargetUsage, taaPass } from './resolve.ts'
import { createTaaHistoryTargets } from './historyTargets.ts'
import { AS_IS_SHARE_FORMAT } from '../lighting/deferred/asIsShare.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { INPUTS, taaGroupEntries, type TaaInputs } from './inputs.ts'
import { createTaaFrameState } from './frameState.ts'
import { createPlacementMotion, type MotionRoot } from './motion.ts'
import { createTaaFilterHistory, type DisplayLayers } from './layers.ts'
import { createTaaAnalysis } from './analysis.ts'
import { standInTexture } from '../gpu/core/standInTexture.ts'

/**
 * Temporal antialiasing pass: two histories in ping-pong at the display size, each a colour and its
 * share target (`historyTargets.ts`), one read and the other written each frame, composition reading
 * the colour just written; and the render-resolution histories of the analysis (`analysis.ts`) —
 * the shading history and the flicker measure —, one of each, read first
 * and written last. The histories
 * follow the display size, the analysis the render targets' (`resize`); bind groups are rebuilt when
 * an input changes identity, never per frame. The analysis runs over the rendered size, then the
 * history update, a fullscreen draw into the display targets, one program for every render scale
 * (`resolveWgsl.ts`).
 */
export async function createTemporalAntialiasing(device: GPUDevice, roots: readonly MotionRoot[]) {
  const resolves = await createTaaResolves(device)
  const motion = createPlacementMotion(device, roots)
  const filterHistory = createTaaFilterHistory(device, resolveTargetUsage())
  const uniform = device.createBuffer({
    label: 'Trillion3D TAA view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // Bilinear and clamped: the histories' reads and the anti-aliaser's luma reads, which must not
  // wrap across the image's edge.
  const sampler = device.createSampler({
    label: 'Trillion3D TAA history sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const analysis = await createTaaAnalysis(device, sampler, uniform)
  // A frame with no transparent reads zero as its reactive value, from this one texel.
  const noReactive = standInTexture(device, 'Trillion3D TAA no reactive', AS_IS_SHARE_FORMAT)
  const noReactiveView = noReactive.createView()
  const history = createTaaHistoryTargets(device),
    { images } = history,
    /** The history update's two groups, one per history read, for each identity the inputs were
     *  seen with: the lit image is one of two HDR targets that take turns
     *  (`reflections/radiance.ts`). */
    held: (GPUBindGroup | undefined)[][] = []
  /** History read on the next frame: the other is written. */
  let read = 0
  /** What the groups name: the layout, then each of `INPUTS` (`bindIdentity.ts`); two held, the
   *  HDR targets' turns. */
  const identity = createWebgpuBindIdentity(2)
  const frame = createTaaFrameState()
  /** The size the render-resolution histories are allocated at, the uniform's analysis grid. */
  const analysisSize = [0, 0]
  /** Each history's update pass, made once its targets are: without the display layers, and with
   *  the layers it was last made for. */
  const passes: {
    plain?: GPURenderPassDescriptor
    filter?: DisplayLayers
    layered?: GPURenderPassDescriptor
  }[] = []
  const passOf = (write: number, filter: DisplayLayers | undefined) => {
    const made = (passes[write] ??= {}),
      { color, share } = images[write]
    const base = [color, share]
    if (!filter) return (made.plain ??= taaPass(base))
    if (made.filter !== filter) {
      made.filter = filter
      made.layered = taaPass([...base, ...filter])
    }
    return made.layered!
  }
  const dropTargets = () => {
    history.drop()
    held.length = 0
    passes.length = 0
    filterHistory.drop()
    analysis.release()
  }
  return {
    uniform,
    motion,
    filterHistory,
    /** The size the analysis's targets and render-resolution histories are made at. */
    get analysisSize(): readonly number[] {
      analysisSize[0] = analysis.width
      analysisSize[1] = analysis.height
      return analysisSize
    },
    /** Bytes of the targets as allocated: what a capture must count beside its own. */
    get historyBytes() {
      return history.bytes + filterHistory.bytes + analysis.bytes
    },
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, motion. */
    frame,
    /** Remakes the targets at another size: the histories at the display's `w × h`, the analysis's
     *  at the render targets' `rw × rh`, the largest a frame is drawn at. Another render size at the
     *  same display and render target size keeps every history. True when a history was
     *  reallocated — the render-resolution ones go with the analysis's targets —, and so is gone. */
    resize(w: number, h: number, rw: number, rh: number) {
      const kept = w === history.width && h === history.height && images.length === 2
      if (kept && rw === analysis.width && rh === analysis.height) return false
      // The groups name the render-resolution targets: made again with them.
      held.length = 0
      if (!kept) {
        dropTargets()
        history.allocate(w, h)
      }
      analysis.allocate(rw, rh)
      return true
    },
    /** Encode the pass, its uniform written first: the analysis of `inputs` drawn at `render`
     *  (`[width, height]`) through an `orthographic` projection or not, then the history update,
     *  which reads it and the history, writes the other target, then swaps roles. Returns the
     *  written colour, share and display layers. */
    encode(
      encoder: GPUCommandEncoder,
      inputs: TaaInputs,
      render: readonly [number, number],
      orthographic = false,
    ) {
      if (images.length !== 2) throw new Error('TAA_TARGETS_MISSING')
      inputs.reactive ??= noReactiveView
      analysis.encode(encoder, inputs, render, orthographic)
      const kind = inputs.share ? 'blended' : inputs.flags ? 'asIs' : 'flagless'
      const layered = inputs.filter && resolves.filtered(kind)
      // Until the layered resolve is compiled, the image resolves no layer: composition reads the raw ones.
      if (!layered) inputs.filter = undefined
      const resolve = layered || resolves[kind]
      filterHistory.follow(inputs.filter, history.width, history.height)
      const { layout } = resolve
      const { next } = identity
      next[0] = layout
      for (let i = 0; i < INPUTS.length; i++) next[1 + i] = inputs[INPUTS[i]]
      const moved = identity.moved(),
        groups = (held[identity.slot] ??= [undefined, undefined])
      if (moved || !groups[0])
        for (let i = 0; i < 2; i++) {
          const entries = taaGroupEntries(inputs, images[i], sampler, uniform, analysis)
          entries.push(...filterHistory.entries(inputs.filter, i))
          groups[i] = device.createBindGroup({ layout, entries })
        }
      const write = 1 - read,
        filter = inputs.filter && filterHistory.target(write)
      const pass = encoder.beginRenderPass(passOf(write, filter))
      pass.setPipeline(resolve.pipeline)
      pass.setBindGroup(0, groups[read]!)
      pass.draw(3)
      pass.end()
      read = write
      filterHistory.written = !!filter
      images[write].filter = filter
      return images[write]
    },
    /** Releases the targets with the frame targets, history gone, until the next `resize`. */
    release: dropTargets,
    dispose() {
      dropTargets()
      motion.dispose()
      uniform.destroy()
      noReactive.destroy()
      this.inputs = {} as TaaInputs
    },
  }
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>
