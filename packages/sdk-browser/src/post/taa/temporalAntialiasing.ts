import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaResolves, resolveTargetUsage } from './resolve.ts'
import { createTaaHistoryTargets } from './historyTargets.ts'
import { AS_IS_SHARE_FORMAT } from '../../lighting/deferred/asIsShare.ts'
import type { TaaInputs } from './inputs.ts'
import type { Velocity } from './velocity.ts'
import { createTaaFilterHistory } from './layers.ts'
import { createHistoryUpdate } from './historyUpdate.ts'
import { createTaaAnalysis } from './analysis.ts'
import type { AnalysisWork } from './levels.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'

/** The view's uniform and the sampler every group of the pass names. */
function createViewResources(device: GPUDevice) {
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
  return { uniform, sampler }
}

/** The targets of the pass and the passes that write them: the display-size histories, their
 *  display layers, the analysis's render-resolution targets and the history update. */
async function createTargets(device: GPUDevice, sampler: GPUSampler, uniform: GPUBuffer) {
  const resolves = await createTaaResolves(device)
  const filterHistory = createTaaFilterHistory(device, resolveTargetUsage())
  const analysis = await createTaaAnalysis(device, sampler, uniform)
  const history = createTaaHistoryTargets(device)
  const update = createHistoryUpdate(device, {
    resolves,
    history,
    filterHistory,
    analysis,
    sampler,
    uniform,
  })
  /** The size the render-resolution histories are allocated at, the uniform's analysis grid. */
  const analysisSize = [0, 0]
  const drop = () => {
    history.drop()
    update.drop()
    filterHistory.drop()
    analysis.release()
  }
  return {
    history,
    filterHistory,
    analysis,
    update,
    drop,
    /** The size the analysis's targets and render-resolution histories are made at. */
    get analysisSize(): readonly number[] {
      analysisSize[0] = analysis.width
      analysisSize[1] = analysis.height
      return analysisSize
    },
    /** Bytes of the targets as allocated: what a capture must count beside its own. */
    get bytes() {
      return history.bytes + filterHistory.bytes + analysis.bytes
    },
    /** Remakes the targets at another size: the histories at the display's `w × h`, the analysis's
     *  at the render targets' `rw × rh`, the largest a frame is drawn at. Another render size at the
     *  same display and render target size keeps every history. True when a history was
     *  reallocated — the render-resolution ones go with the analysis's targets —, and so is gone. */
    resize(w: number, h: number, rw: number, rh: number) {
      const kept = w === history.width && h === history.height && history.images.length === 2
      if (kept && rw === analysis.width && rh === analysis.height) return false
      // The groups name the render-resolution targets: made again with them.
      update.regroup()
      if (!kept) {
        drop()
        history.allocate(w, h)
      }
      analysis.allocate(rw, rh)
      return true
    },
  }
}

/**
 * Temporal antialiasing pass: two histories in ping-pong at the display size, each a colour and its
 * share target (`historyTargets.ts`), one read and the other written each frame, composition reading
 * the colour just written; and the render-resolution histories of the analysis (`analysis.ts`) —
 * the shading history and the flicker measure —, one of each, read first and written last. The
 * histories follow the display size, the analysis the render targets' (`resize`). The analysis runs
 * over the rendered size, then the history update (`historyUpdate.ts`), a fullscreen draw into the
 * display targets, one program for every render scale (`resolveWgsl.ts`).
 */
export async function createTemporalAntialiasing(device: GPUDevice, velocity: Velocity) {
  const { uniform, sampler } = createViewResources(device)
  const targets = await createTargets(device, sampler, uniform)
  const { analysis, update, history } = targets
  // A frame with no transparent reads zero as its reactive value and as the history its layers give
  // up, from this one texel.
  const noReactive = standInTexture(device, 'Trillion3D TAA no reactive', AS_IS_SHARE_FORMAT)
  const noReactiveView = noReactive.createView()
  return {
    uniform,
    filterHistory: targets.filterHistory,
    get analysisSize() {
      return targets.analysisSize
    },
    get historyBytes() {
      return targets.bytes
    },
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, motion; the velocity
     *  stage keeps the view's last image with it (`velocity.frame`). */
    frame: velocity.frame,
    resize: targets.resize,
    /** Encode the pass, its uniform written first: the analysis of `inputs` drawn at `render`
     *  (`[width, height]`) through an `orthographic` projection or not, then the history update,
     *  which reads it and the history, writes the other target, then swaps roles. Returns the
     *  written colour, share and display layers. */
    encode(
      encoder: GPUCommandEncoder,
      inputs: TaaInputs,
      render: readonly [number, number],
      orthographic = false,
      work?: AnalysisWork,
    ) {
      if (history.images.length !== 2) throw new Error('TAA_TARGETS_MISSING')
      inputs.reactive ??= noReactiveView
      inputs.givenUp ??= noReactiveView
      analysis.encode(encoder, inputs, render, orthographic, work)
      return update.encode(encoder, inputs)
    },
    /** Releases the targets with the frame targets, history gone, until the next `resize`. */
    release: targets.drop,
    dispose() {
      targets.drop()
      uniform.destroy()
      noReactive.destroy()
      this.inputs = {} as TaaInputs
    },
  }
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>
