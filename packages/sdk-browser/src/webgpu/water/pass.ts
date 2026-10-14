// The water pass's frame side: the words its rectangle projects with and its encoding, on the pass
// the blend stage built once its code arrived (`waterPass.ts`).
import { countBlendDraws } from '../blend/draw.ts'
import { writeWaterFrame } from './frameWords.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { directLightResources } from '../pages/prepare/contractLight.ts'
import { lobesHeld } from '../pages/prepare/lobesTarget.ts'

/** Whether this image composes water: a beauty view, no second-camera capture, a composition. */
function composesWater(rt: WebgpuPagesRuntime, composes: boolean) {
  return (
    rt.run.diagnostic === 'beauty' && !rt.capture.capturing && composes && !!rt.blendState.water
  )
}

/**
 * Whether this image wants the water pass — it composes water, the scene transmits, the target has
 * pixels —, and if so the words its rectangle projects with, under the image's jittered
 * `projection` (`frameWords.ts`). Whether the pass is then encoded is the frame's verdict's
 * (`../blend/expansionFrame.ts`), and whether it draws the GPU's.
 */
export function boundWaterPass(
  rt: WebgpuPagesRuntime,
  composes: boolean,
  projection: ArrayLike<number>,
) {
  const { blendState } = rt,
    size = rt.gpu.targetSize
  blendState.waterWanted =
    composesWater(rt, composes) && blendState.transmissive > 0 && size[0] > 0 && size[1] > 0
  if (blendState.waterWanted) writeWaterFrame(blendState, rt.run.gate.cam, projection, size)
}

/**
 * Whether the water pass draws the image's transmission slice, as far as the frame knows before
 * it binds: its rectangle's kernels ran (`waterBound`), and the pass encodes on them.
 */
function drawsWater(rt: WebgpuPagesRuntime, composes: boolean) {
  const { blendState } = rt
  return (
    composesWater(rt, composes) &&
    blendState.waterBound &&
    !!blendState.expand &&
    !!blendState.argsBuffer &&
    !!blendState.viewBuffer &&
    !!blendState.lighting
  )
}

/**
 * Encodes the water pass after the blends, on the image they left (`frame.ts`).
 * Returns whether the slice was handled: the pass encoded, or no transmissive item in view while
 * nothing moved (`waterQuiet`, `../blend/expansionFrame.ts`), when nothing is encoded at all.
 * Without its rectangle's kernels this image, without the pipelines, under a diagnostic view or a
 * capture from a second camera, nothing of it exists in the frame, and the transmission slice
 * draws as one more blend. So too when no
 * composition `composes` the image after it: the water word borrows the display colour
 * (`surfaceWgsl.ts`), which only that composition writes over. Whether a surface draws once
 * encoded is the GPU's alone: every draw and copy of the pass takes its count from the verdict.
 * `key`, the frame's lights' key (`directLightResources`, resolved here when not given), picks the
 * composite's program (`frame.ts`). A transmissive surface that carries a lobe draws through the
 * lobed stage (`lobedStage.ts`) once it compiled — the frames held until then
 * (`askLobedPrograms`) — and the lobes target is full-size (`wantsPhysicalLobes`).
 */
export function encodeWaterPass(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  composes = true,
  key?: Partial<ContractKey>,
) {
  const { gpu, run, blendState } = rt,
    water = blendState.water
  // A diagnostic view colours a surface instead of lighting it: the slice draws as a blend, whose
  // fragment carries that colouring, and the composite has none. A capture from a second camera
  // reads the surface buffer as opaque once the frame is drawn: the surface stage leaves it alone.
  const { viewBuffer, lighting, expand, itemBuffer } = blendState
  // No transmissive item can draw this image (`waterQuiet`): the slice is handled, drawn by none.
  if (blendState.waterQuiet && composesWater(rt, composes)) return true
  if (
    !drawsWater(rt, composes) ||
    !water ||
    !viewBuffer ||
    !lighting ||
    !expand ||
    !itemBuffer ||
    !water.frame.bind(gpu, viewBuffer, lighting, itemBuffer, expand.buffers.verdict)
  )
    return false
  const lit = key ?? directLightResources(rt)
  // The lobed stage once compiled (`lobedStage.ts`), into a full-size lobes target; else the plain.
  const lobed = blendState.waterLobed && lobesHeld(rt) ? water.lobed.get() : undefined
  const surfaces = lobed ?? water.surfaces
  countBlendDraws(rt, water.frame.encode(rt, encoder, surfaces, lit, !!lobed), true)
  run.gpuDrawCalls++
  return true
}
