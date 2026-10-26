import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { skyLightCubemapRotation } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { createCubemapPipelines, type CubemapPipelines } from './cubemapPipelines.ts'
import { copyBlockGroup, copyFacePass, createCopyWords, type FaceCopy } from './captureCopy.ts'
import { sameHeld, type Held, type SkyLightInputs } from './captureInputs.ts'
import { finishCapture, type FilterStage } from './captureFilter.ts'
import { CUBE_FACES } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'
import { cubemapKey } from './cubemapKey.ts'

/**
 * THE CAPTURE OF A SPECIFIED CUBEMAP: the host's cube taken to the filtered cube and the harmonics,
 * whole in a frame, once for a cube, an angle, a side, a lower hemisphere (its flag, its colour and its
 * coverage) and the scale the light is given. The cube is 16-bit, already rescaled to fit the half
 * float (`openSkyCubemap`); nothing is measured on the GPU.
 */
interface CubemapShared {
  readonly device: GPUDevice
  readonly failed: (error: unknown) => void
  readonly filters: FilterStage
  /** Made when the first cubemap is captured. */
  pipelines?: CubemapPipelines
  copyBlock?: { for: SkyLightTargets; group: GPUBindGroup }
  sampler?: GPUSampler
  readonly words: ReturnType<typeof createCopyWords>
}

/** The capture of one cube: the source (`w` 0) or the blend's destination (`w` 1, `SetCubemapBlend`), each its own
 *  filtered cube and harmonics, captured in a frame of its own (they share the copy's block). */
interface CubemapHolds {
  readonly w: 0 | 1
  readonly shared: CubemapShared
  key?: Held
  /** The share of the cube's light the lighting is given (`SkyLightInputs.cubemapScale`). */
  scale: number
  done: boolean
  copySource?: { for: GPUTexture; group: GPUBindGroup }
}

/** The groups of the copy: the host's cube read bilinearly, and the copy's block. */
function copyGroups(
  h: CubemapHolds,
  t: SkyLightTargets,
  cubemap: GPUTexture,
  made: CubemapPipelines,
) {
  const { device } = h.shared
  if (h.copySource?.for !== cubemap) {
    h.shared.sampler ??= postSamplers(device).clamped
    h.copySource = {
      for: cubemap,
      group: device.createBindGroup({
        layout: made.layouts.source,
        entries: [
          {
            binding: 0,
            resource: cubemap.createView({ dimension: 'cube', baseMipLevel: 0, mipLevelCount: 1 }),
          },
          { binding: 1, resource: h.shared.sampler },
        ],
      }),
    }
  }
  if (h.shared.copyBlock?.for !== t)
    h.shared.copyBlock = { for: t, group: copyBlockGroup(device, made.layouts.block, t) }
  return { source: h.copySource.group, block: h.shared.copyBlock.group }
}

/** The faces of the captured cube written from the host's cube (`copyFaceMain`). */
function copyFaces(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
  cubemap: GPUTexture,
  made: CubemapPipelines,
) {
  const groups = copyGroups(h, t, cubemap, made)
  const { light } = input.part
  const rotation = skyLightCubemapRotation(input.part)
  const copy: FaceCopy = {
    pipeline: made.pipelines.copy.get(),
    source: groups.source,
    block: groups.block,
    turn: [Math.sin(rotation), Math.cos(rotation)],
    scale: [1, 1, 1, 1],
  }
  for (let face = 0; face < CUBE_FACES; face++)
    copyFacePass(h.shared.device, h.shared.words, encoder, t, light, face, copy)
}

/** The cube `cubemap` taken to filtered cube `h.w` and its harmonics, whole in a frame once for a
 *  key (`cubemapKey`). */
function encodeCubemap(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
  cubemap: GPUTexture,
  scale = 1,
) {
  const { shared } = h
  const made = (shared.pipelines ??= createCubemapPipelines(shared.device, shared.failed))
  if (!made.ready()) return
  const key = cubemapKey(cubemap, t, input, scale)
  if (!sameHeld(h.key, key)) {
    h.key = key
    h.done = false
    h.scale = scale
  }
  if (h.done) return
  copyFaces(h, encoder, t, input, cubemap, made)
  finishCapture(shared.filters, encoder, t, h.w)
  h.done = true
}

/** A cube's capture state, none yet. */
const newHolds = (w: 0 | 1, shared: CubemapShared): CubemapHolds => ({
  w,
  shared,
  scale: 1,
  done: false,
})

/**
 * The capture of a specified cubemap, and of the cube it blends to (`SkyLightInputs.blend`,
 * `SetCubemapBlend`): `encode` this frame's work — the source first, the destination in the frames
 * after the source is done —, `reset` when the targets or the source change, `done`, `scale` and
 * `blend` for what the lighting reads.
 */
export function createCubemapCapture(
  device: GPUDevice,
  failed: (error: unknown) => void,
  filters: FilterStage,
) {
  const shared: CubemapShared = { device, failed, filters, words: createCopyWords() }
  const [source, destination] = [newHolds(0, shared), newHolds(1, shared)]
  /** The fraction of the destination the lighting reads, clamped to 0 .. 1: `blend` of an unfinished or absent destination is 0. */
  let fraction = 0
  return {
    encode(encoder: GPUCommandEncoder, t: SkyLightTargets, input: SkyLightInputs) {
      const { cubemap, blend } = input
      // A destination is captured once the source is, never in its frame (the copy's blocks are shared).
      const sourceDone = source.done
      if (cubemap) encodeCubemap(source, encoder, t, input, cubemap, input.cubemapScale)
      else {
        // No cubemap, no light: the last cube stops lighting.
        source.key = undefined
        source.done = false
      }
      const next = blend && blend.fraction > 0 && sourceDone ? blend : undefined
      if (next) encodeCubemap(destination, encoder, t, input, next.destination, next.scale)
      fraction = next && destination.done ? Math.min(next.fraction, 1) : 0
    },
    reset() {
      for (const h of [source, destination]) {
        h.key = undefined
        h.done = false
      }
      fraction = 0
    },
    /** The cubemap's and the captured scene's pipelines, made at the first call. */
    pipelines: () => (shared.pipelines ??= createCubemapPipelines(device, failed)),
    get done() {
      return source.done
    },
    /** The cube the lighting reads first: the source, or, a blend whole, the destination. */
    get layer(): 0 | 1 {
      return fraction >= 1 ? 1 : 0
    },
    /** The share of the destination the lighting mixes into the source's cube (0 when none, or when
     *  the destination is the cube read). */
    get blend() {
      return fraction >= 1 ? 0 : fraction
    },
    /** The share of the cube's light the lighting is given: the pair is rescaled alike
     *  (`cubemapPairFit`), so the source's and the destination's are one. */
    get scale() {
      return fraction >= 1 ? destination.scale : source.scale
    },
  }
}
