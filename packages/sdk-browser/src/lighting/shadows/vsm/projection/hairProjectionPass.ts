/**
 * Host side of the projection onto the hair strands: the passes of the projection over the input
 * `strands` (`projectionWgsl.ts`, `../inputType.ts`, the pipelines and groups `projectionPipelines.ts` and
 * `projectionPass.ts` make for every input), into masks of the strands' own — the suns' (a layer a sun)
 * and the local lights' (the shares of the lights of the pixel's cell) —, after the opaque projection wrote
 * the frame's view uniform they both read. Each pass is an indirect dispatch over the list of all the tiles
 * with strands. Gated on the strands being valid for the view: given none, the masks are given back.
 */
import { chainReady } from '../../../deferred/fullscreen.ts'
import { type HeldGroup, heldGroup } from '../../../../gpu/bind/bindIdentity.ts'
import { ensureSet, type HeldSet } from '../../../../gpu/core/heldTextures.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import type { HairShadowSource } from '../../../../hair/viewGpu.ts'
import { HAIR_ALL_TILES_DISPATCH } from '../../../../hair/visibilityMath.ts'
import { vsmPerFrameSet, type VsmResources } from '../resources.ts'
import { onePassMaskFormat, VSM_SUN_MASK_FORMAT } from './maskFormat.ts'
import {
  localsPipeline,
  passesOf,
  pipelinesFor,
  sunsPipeline,
  tablesGroup,
} from './projectionPipelines.ts'
import { vsmProjectionReserve } from './projectionStore.ts'
import { sunCount } from './projectionView.ts'
import {
  passGroupFor,
  projectsLocals,
  type VsmProjectionFrame,
  type VsmProjectionSource,
  type VsmProjectionTarget,
} from './projectionPass.ts'

const PASS = `${VSM_PASS_PREFIX}projection.hair`
const PASS_DESCRIPTOR: GPUComputePassDescriptor = { label: PASS }

type MaskFormat = ReturnType<typeof onePassMaskFormat>

/** The mask images a set holds, each made where its mask is asked. */
type HairMaskImages = { sunsImage?: GPUTexture; localsImage?: GPUTexture }

/** The masks of the strands' projection: written in the pixels of the tiles with strands alone. */
export interface VsmHairMasks {
  /** A layer a sun; none where the frame holds no sun. */
  readonly suns: GPUTextureView | undefined
  /** The shares of the shadowed local lights of the pixel's cell; none where the frame holds none. */
  readonly locals: GPUTextureView | undefined
  readonly localFormat: MaskFormat
  /** The size and the sun layers they were made for. */
  readonly width: number
  readonly height: number
  readonly sunLayers: number
}

/** Whether `masks` hold an image of `width` by `height` with `sunLayers` suns and, where `format` is
 *  given, the local lights' mask of that format. */
const masksFit = (
  masks: VsmHairMasks,
  width: number,
  height: number,
  sunLayers: number,
  format: MaskFormat | undefined,
) =>
  masks.width >= width &&
  masks.height >= height &&
  (!sunLayers || (!!masks.suns && masks.sunLayers === sunLayers)) &&
  (!format || (!!masks.locals && masks.localFormat === format))

/** The masks of a set and the groups of the passes, kept on the set (`HAIR_STATES`). */
interface HairProjectionHeld {
  masks?: VsmHairMasks & HeldSet
  suns: HeldGroup
  locals: HeldGroup
}
const HAIR_STATES = new WeakMap<VsmResources, HairProjectionHeld>()

const heldOf = (res: VsmResources) => {
  let held = HAIR_STATES.get(res)
  if (!held) HAIR_STATES.set(res, (held = { suns: heldGroup(), locals: heldGroup() }))
  return held
}

/** The masks of the strands' projection of the last image of `res`, none while the strands are none for
 *  the view: what the lighting of the strands reads. */
export const vsmHairMasks = (res: VsmResources): VsmHairMasks | undefined =>
  HAIR_STATES.get(res)?.masks

/** The bytes the strands' masks of `res` hold. */
export const vsmHairProjectionBytes = (res: VsmResources) => HAIR_STATES.get(res)?.masks?.bytes ?? 0

/** Gives back the masks of `res`: the strands are gone from the view, or the set is. */
export function releaseVsmHairProjection(res: VsmResources) {
  const held = HAIR_STATES.get(res)
  held?.masks?.dispose()
  HAIR_STATES.delete(res)
}

/** The strands' masks of the asked size, the ones held where they fit, else made (and grown only: a view that shrinks keeps the larger masks). */
function ensureHairMasks(
  device: GPUDevice,
  held: HairProjectionHeld,
  target: VsmProjectionTarget,
  width: number,
  height: number,
  sunLayers: number,
  format: VsmProjectionTarget['localFormat'] | undefined,
) {
  if (!(held.masks && masksFit(held.masks, width, height, sunLayers, format))) {
    // Made at the asked size and grown only: a view that shrinks keeps the larger masks.
    const made = ensureSet<HairMaskImages, VsmHairMasks>(
      held.masks,
      device,
      {
        key: [width, height, sunLayers, format],
        what: 'the shadow masks of the hair strands',
        label: 'Trillion3D hair shadow masks',
      },
      (allocator) => ({
        sunsImage: sunLayers
          ? allocator.image('suns', [width, height, sunLayers], VSM_SUN_MASK_FORMAT)
          : undefined,
        localsImage: format ? allocator.image('locals', [width, height], format) : undefined,
      }),
      (images) => ({
        suns: images.sunsImage?.createView({ dimension: '2d-array' }),
        locals: images.localsImage?.createView(),
        localFormat: target.localFormat,
        width,
        height,
        sunLayers,
      }),
    )
    held.masks = made.resources
  }
  return held.masks
}

/** What the strands' projection passes share: the device, the state and its groups, the frame and the strands. */
interface HairProjectionCommon {
  readonly device: GPUDevice
  readonly state: ReturnType<typeof vsmProjectionReserve>
  readonly held: ReturnType<typeof heldOf>
  readonly p: ReturnType<typeof pipelinesFor>
  readonly frame: VsmProjectionFrame
  readonly source: VsmProjectionSource
  readonly hair: HairShadowSource
  readonly pass: GPUComputePassEncoder
}

/** The suns' projection onto the strands, into `mask`. */
function encodeHairSuns(
  { device, state, held, p, frame, source, hair, pass }: HairProjectionCommon,
  pipeline: GPUComputePipeline,
  mask: GPUTextureView,
  res: VsmResources,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    1,
    passGroupFor(
      device,
      state,
      held.suns,
      passesOf(p, 'strands').sunsLayout,
      frame.hizDepth,
      source,
      mask,
      {
        filterableMerged: res.filterable?.merged,
        strands: hair,
      },
    ),
  )
  pass.dispatchWorkgroupsIndirect(hair.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}

/** The local lights' projection onto the strands, into `mask`, over the shadowed lights' grid. */
function encodeHairLocals(
  { device, state, held, frame, source, hair, pass }: HairProjectionCommon,
  pipeline: GPUComputePipeline,
  groupLayout: GPUBindGroupLayout,
  mask: GPUTextureView,
  lightGrid: GPUBuffer | undefined,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    1,
    passGroupFor(device, state, held.locals, groupLayout, frame.hizDepth, source, mask, {
      lightGrid,
      strands: hair,
    }),
  )
  pass.dispatchWorkgroupsIndirect(hair.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}

/**
 * Projects the frame's lights (`writeVsmProjectionFrame`, written before) onto the strands `hair`: the
 * suns into a layer each of the suns' mask, the local lights, in one pass, into the local mask, both the
 * strands' own at the size of the view. The local lights' pass runs where the opaque one does
 * (`projectsLocals`: the one-pass mask made, the grid pruned): on the per-light path each light is
 * projected alone, which the lighting of the strands encodes. Returns the masks, none while the strands
 * are none for the view (`hair` undefined: the masks are given back), the blue noise is not made, or a
 * pipeline compiles. `source` and `target` are the opaque projection's (the light lists and the shadowed
 * lights' grid it reads); the lights are `frame`'s, the suns first.
 */
export function encodeVsmHairProjection(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
  hair: HairShadowSource | undefined,
): VsmHairMasks | undefined {
  if (!hair) {
    releaseVsmHairProjection(res)
    return undefined
  }
  const { device, width, height, lights } = frame
  const state = vsmProjectionReserve(device, res)
  if (!state.uniform || !state.blueNoiseView) return undefined
  const p = pipelinesFor(device, res.layout)
  const sunLayers = sunCount(lights)
  const locals = projectsLocals(lights, source, target)
  const suns = sunLayers ? sunsPipeline(p, 'strands') : undefined
  const local = locals ? localsPipeline(p, target.localFormat, 'strands') : undefined
  if (!chainReady(suns, local?.pipeline)) return undefined
  const held = heldOf(res)
  const format = locals ? target.localFormat : undefined
  const masks = ensureHairMasks(device, held, target, width, height, sunLayers, format)
  if (!masks) return undefined
  const pass = steps.pass(PASS_DESCRIPTOR)
  pass.setBindGroup(0, vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout))
  const common = { device, state, held, p, frame, source, hair, pass }
  const sunsCompiled = suns?.get()
  if (sunsCompiled && masks.suns) encodeHairSuns(common, sunsCompiled, masks.suns, res)
  const localsCompiled = local?.pipeline.get()
  if (local && localsCompiled && masks.locals)
    encodeHairLocals(common, localsCompiled, local.groupLayout, masks.locals, target.lightGrid)
  return masks
}
