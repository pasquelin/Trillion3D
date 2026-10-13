import { writeKeyRecords, writeMovedKeyRecords } from './keyRecords.ts'
import { writeWaterItems } from '../water/waterItems.ts'
import { BLEND_ORDER_PASS } from '../../stage/passLabels.ts'
import type { BlendExpand } from './expand.ts'
import type { WebgpuBlendState } from './state.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/**
 * What the GPU verdict reads, sent where it moved: the plan with every key and water item record,
 * or the key records noted stale since (`noteKeyRecord`); and the frustum planes, compared with
 * those the last verdict judged. Each move counts in `verdictEpoch`, under which the verdict's
 * counts come back (`verdictRead.ts`).
 */
function sendVerdictInputs(blendState: WebgpuBlendState, expand: BlendExpand) {
  if (blendState.planMoved) {
    expand.uploadPlan({
      passes: blendState.seeds.map((passSeeds, pass) => ({
        seeds: passSeeds,
        counts: {
          entries: passSeeds.length,
          runs: blendState.slotCounts[pass],
          instanceBase: blendState.instanceBase[pass],
        },
        region: blendState.planRegions[pass],
      })),
      scene: blendState,
      stepWords: blendState.orderStepWords,
      keyWords: writeKeyRecords(blendState),
      waterWords: writeWaterItems(blendState),
    })
    blendState.planMoved = false
    blendState.verdictEpoch++
  } else {
    const moved = writeMovedKeyRecords(blendState)
    if (moved) {
      expand.uploadKeys(moved.first, moved.words)
      blendState.verdictEpoch++
    }
  }
  const planes = blendState.blendPlanes,
    judged = blendState.judgedPlanes
  for (let k = 0; k < planes.length; k++)
    if (planes[k] !== judged[k]) {
      judged.set(planes)
      blendState.verdictEpoch++
      break
    }
}

/**
 * Whether no water can draw this image: the counts an image judged under the same inputs came back
 * with no transmissive item in view (`VERDICT_IN_VIEW`). The pass is then not encoded, not even
 * empty, nor the slice as a blend (`waterQuiet`): every transmissive item is out of view, and
 * draws no pixel. An image with any input moved since encodes the pass, and the GPU gates what it
 * draws. The CPU never waits for the answer: until one comes back for the current inputs, the pass
 * is encoded.
 *
 * What an encoded empty pass costs, for the recette (DC-1), on a tile-based GPU where a pass loads
 * and stores its attachments whether it draws or not: with `b(t)` a texel's bytes of attachment
 * `t` (`waterSurfaceTargets`, the water depth, the composite's HDR target and its display layers
 * and share when present), `W × H` the target,
 *   `t_empty = W·H·(Σ_loaded b + Σ_stored b) / bandwidth + 2·t_pass + t_dispatch`,
 * where a `load` attachment is read and every attachment is stored, a `clear` one read for nothing;
 * the copy's zero workgroups and the quads' zero instances add a dispatch and two draws each of no
 * work (`t_dispatch`, microseconds). The recette measures it against no pass at all (an xctrace of
 * the two passes with water out of view, 1080p and 4K): this skip leaves it only to the images
 * where the view or a transmissive item moves while no water is in view.
 */
const noWaterInView = (blendState: WebgpuBlendState, expand: BlendExpand) =>
  expand.counts.epoch === blendState.verdictEpoch && expand.counts.inView === 0

/**
 * What the image asks of the kernels: the verdict's inputs where they moved and the frame data,
 * then in ONE compute pass the frustum verdict of every item (`verdictWgsl.ts`), the water
 * rectangle when the image wants water (`../water/rect.ts`), and for each pass its order and its
 * expansion; then the verdict's counts to the readback.
 *
 * Dispatches of the same compute pass are ordered and see the previous writes: the expansion reads
 * the keep words the verdict wrote, blend hands its work memory back to transmission, whose
 * instances and arguments live in their own regions.
 */
export function encodeBlendExpansion(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState } = rt,
    expand = blendState.expand,
    { runCount, seeds } = blendState
  const wanted = blendState.waterWanted
  blendState.waterWanted = blendState.waterBound = blendState.waterQuiet = false
  if (!expand) return
  // No slot to draw: a frame without an eye paints nothing (`order.ts`).
  if (!runCount[0] && !runCount[1]) return
  sendVerdictInputs(blendState, expand)
  expand.uploadFrame(blendState.frameWords, blendState.frameLayout.words)
  const water = blendState.water,
    { itemBuffer } = blendState,
    volumes = rt.gpu.volumeBuffer
  const quiet = wanted && noWaterInView(blendState, expand)
  const rect = wanted && !quiet ? water?.rect : undefined
  const bound = !!(rect && itemBuffer && volumes)
  expand.clearVerdict(encoder)
  const pass = encoder.beginComputePass({ label: BLEND_ORDER_PASS })
  expand.judge(pass)
  if (rect && itemBuffer && volumes)
    rect.encode(pass, expand.buffers, itemBuffer, volumes, blendState.transmissive)
  for (let slice = 0; slice < seeds.length; slice++)
    if (runCount[slice])
      expand.encode(pass, slice, blendState.orderSteps[slice], {
        entries: seeds[slice].length,
        runs: runCount[slice],
      })
  pass.end()
  expand.readCounts(encoder, blendState.verdictEpoch)
  blendState.waterBound = bound
  blendState.waterQuiet = quiet
}
