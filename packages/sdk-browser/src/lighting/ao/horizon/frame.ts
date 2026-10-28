import { NEVER_SEEN } from '../../../frame/backend/state/previousCamera.ts'
import type { AmbientOcclusionSettings } from '../../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { clipToPreviousClip } from '../../../../../math/src/matrix/matrix4Motion.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import {
  aoCommonEntries,
  aoPassGroups,
  createAoScratch,
  specCache,
  type AoMethod,
  type AoNeeded,
} from '../method.ts'
import type { AoImage } from '../params.ts'
import type { AoView } from '../view.ts'
import { HORIZON_BINDINGS as B, HORIZON_PARAMS, HORIZON_PARAMS_BYTES } from './layout.ts'
import { writeHorizonParams } from './params.ts'
import {
  horizonFormatOf,
  horizonPasses,
  horizonTargetExtent,
  horizonTargetRect,
  horizonTargets,
  type HorizonPass,
} from './plan.ts'
import { horizonPrograms } from './pipelines.ts'
import { horizonShapeOf, type HorizonShape } from './searchWgsl.ts'
import { HORIZON_GROUP } from './tables.ts'

/** What the occlusion keeps of the horizon method from one image to the next, on the view's state (`createHorizonHistory`): the view
 *  its history is in, which of the history's two textures the next image reads, whether it holds an image, how many images were
 *  drawn on it since it was last dropped (`images`), the rectangle that image was drawn in, and the number of that image
 *  (`seen`): the view's camera of the image before is the history's camera where `seen` is that image (`cameraSeen`). It outlives
 *  a change of settings: it is dropped for a new view (the history's textures were made again), a cut, a camera it lacks, or a
 *  plan that has no history. */
export interface HorizonHistory {
  view: AoView | undefined
  parity: 0 | 1
  valid: boolean
  images: number
  rect: [number, number]
  seen: number
}

/** A history that holds no image yet. */
export const createHorizonHistory = (): HorizonHistory => ({
  view: undefined,
  parity: 0,
  valid: false,
  images: 0,
  rect: [0, 0],
  seen: NEVER_SEEN,
})

/** The share of the limit the history reaches before a view may rest: nine tenths. */
const SETTLED_SHARE = 0.9

/** The images the temporal filter needs to bring its history within a tenth of what it converges to, at the share `blend` of each
 *  image it takes: the history keeps `1 − blend` of itself, so after `n` images the first image weighs `(1 − blend)ⁿ`; one image
 *  where nothing is kept (a blend of 1 or more) or the history never moves (a blend of 0 or less): nothing to wait for. */
export const settlingImages = (blend: number) =>
  blend > 0 && blend < 1 ? ceilDiv(Math.log(1 - SETTLED_SHARE), Math.log(1 - blend)) : 1

/** What the passes are told of the history (`HorizonFrame`), refilled for each image: the rectangle it holds, whether the
 *  vectors of motion are bound, and where this image's clip positions fell in the last image's. */
interface ScratchFrame {
  historyRect: [number, number]
  vectors: boolean
  clipToPrevious: ArrayLike<number>
}

/** What a method refills for each pass and each image instead of making it: the draw's descriptor, the compute pass's, the
 *  uniform's words (and the same as the integers `writeChanged` compares), the rectangle drawn, the matrices of the motion and
 *  what the passes are told of the history — one set for each view's method, shared with no other. */
function createScratch() {
  const clipToPrevious = new Float32Array(16)
  const frame: ScratchFrame = { historyRect: [1, 1], vectors: false, clipToPrevious }
  return {
    ...createAoScratch(HORIZON_PARAMS.words),
    compute: { label: AMBIENT_OCCLUSION_PASS },
    current: new Float64Array(16),
    inverse: new Float64Array(16),
    motion: new Float64Array(16),
    clipToPrevious,
    frame,
  }
}
type Scratch = ReturnType<typeof createScratch>

/** The groups of a view's passes, made over the depth, the normals, the vectors and — where the history is read — the
 *  history of this parity, and kept for the resources and the parity the view has met (`AoView.identity`). A pass reads the
 *  texture of the one before; the spatial filter, a compute pass, has a group of its own over its input and its output; a pass
 *  that reads none of what the group offers is bound to a stand-in. */
function groupsOf(
  view: AoView,
  programs: ReturnType<typeof horizonPrograms>,
  passes: readonly HorizonPass[],
  needed: AoNeeded,
  history: HorizonHistory,
) {
  const { identity } = view
  const { next } = identity
  next[0] = needed.depth
  next[1] = needed.normals
  next[2] = needed.vectors
  next[3] = history.valid
  next[4] = history.parity
  if (identity.moved())
    aoPassGroups(view, needed.device, passes, (pass, at) => ({
      label: `${AMBIENT_OCCLUSION_PASS} horizon ${pass.target}`,
      ...(pass.kind === 'spatial'
        ? {
            layout: programs.spatialLayout,
            entries: [
              ...aoCommonEntries(view.params[at], needed, false),
              { binding: B.input, resource: view.textures[pass.input!] },
              { binding: B.spatialOut, resource: view.textures[pass.target] },
            ],
          }
        : {
            layout: programs.layout,
            entries: [
              ...aoCommonEntries(view.params[at], needed),
              {
                binding: B.input,
                resource: pass.input ? view.textures[pass.input] : needed.empty,
              },
              {
                binding: B.history,
                resource:
                  pass.history && history.valid ? view.textures[pass.history] : programs.noHistory,
              },
              { binding: B.vectors, resource: needed.vectors ?? programs.noVectors },
            ],
          }),
    }))
  return view.groups[identity.slot]
}

/** The program a pass that is drawn is drawn with: every pass but the spatial filter, which is dispatched. */
const pipelineOf = (
  programs: ReturnType<typeof horizonPrograms>,
  shape: HorizonShape,
  kind: Exclude<HorizonPass['kind'], 'spatial'>,
) =>
  (kind === 'combine'
    ? programs.search(shape)
    : kind === 'temporal'
      ? programs.temporal
      : programs.upsample
  ).get()

/** Where this image's clip positions fell in the last image's, written into `clipToPrevious`: the last view-projection `before`
 *  over the inverse of this one — none, the identity, where there is no last image. */
function putMotion(
  scratch: Scratch,
  before: Float64Array | undefined,
  viewProjection: ArrayLike<number>,
) {
  const { current, inverse, motion, clipToPrevious } = scratch
  clipToPreviousClip(motion, current, inverse, viewProjection, before)
  clipToPrevious.set(motion)
}

/** One pass drawn: the spatial filter a compute dispatch over the rectangle's groups, every other a fullscreen draw of it. */
function encodePass(
  scratch: Scratch,
  programs: ReturnType<typeof horizonPrograms>,
  shape: HorizonShape,
  pass: HorizonPass,
  encoder: GPUCommandEncoder,
  target: GPUTextureView,
  group: GPUBindGroup,
) {
  const { rect } = scratch
  if (pass.kind !== 'spatial')
    return scratch.draw(
      encoder,
      target,
      pipelineOf(programs, shape, pass.kind),
      group,
      undefined,
      rect,
    )
  const pipeline = programs.spatial.get()
  if (!pipeline) return
  const compute = encoder.beginComputePass(scratch.compute)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(ceilDiv(rect[0], HORIZON_GROUP[0]), ceilDiv(rect[1], HORIZON_GROUP[1]))
  compute.end()
}

/** The passes of the settings drawn over the view's textures for the parity of the history this image reads: the groups, then
 *  each pass's uniform — the words that moved go up — and its draw; the history left holding this image's temporal result. */
function drawPasses(
  passes: readonly HorizonPass[],
  scratch: Scratch,
  settings: AmbientOcclusionSettings,
  shape: HorizonShape,
  history: HorizonHistory,
  encoder: GPUCommandEncoder,
  view: AoView,
  needed: AoNeeded,
  image: AoImage,
) {
  const { downscale } = settings.horizon
  const { frame, rect } = scratch
  const programs = horizonPrograms(needed.device)
  const groups = groupsOf(view, programs, passes, needed, history)
  frame.vectors = !!needed.vectors
  frame.historyRect[0] = history.valid ? history.rect[0] : 1
  frame.historyRect[1] = history.valid ? history.rect[1] : 1
  for (let at = 0; at < passes.length; at++) {
    const pass = passes[at]
    writeHorizonParams(scratch.words, pass, settings, image, frame, scratch.terms)
    writeChanged(needed.device, view.params[at], scratch.sent, 0, HORIZON_PARAMS.words)
    horizonTargetRect(pass.target, image.view, downscale, rect)
    encodePass(scratch, programs, shape, pass, encoder, view.textures[pass.target], groups[at])
    if (pass.kind === 'temporal') {
      history.rect[0] = rect[0]
      history.rect[1] = rect[1]
    }
  }
}

/**
 * THE HORIZON SEARCH (`ambientOcclusionMethod: 'horizon'`): the passes of the settings (`horizonPasses`) over a view whose
 * textures are the search's, the spatial filter's, the history's pair and the occlusion's. A frame reads the history, which the
 * view's state keeps through any change of settings, where the view holds an image of the last frame — never after a cut or in a
 * view made again — or a white texel, and draws the passes in order, each reading the one before; the history then holds this
 * image's temporal result, and the next frame reads the other texture.
 */
export function horizonMethod(
  settings: AmbientOcclusionSettings,
  history: HorizonHistory,
): AoMethod {
  const { horizon } = settings
  const passes = horizonPasses(horizon)
  const shape = horizonShapeOf(settings.shaderQuality, horizon.normals)
  const targets = horizonTargets(horizon)
  const scratch = createScratch()
  const cache = specCache((extent) => ({
    textures: targets.map((name) => ({
      name,
      size: horizonTargetExtent(name, extent, horizon.downscale),
      format: horizonFormatOf(name),
      storage: name === 'spatial',
    })),
    passes: passes[0].length,
    paramBytes: HORIZON_PARAMS_BYTES,
  }))
  return {
    spec: cache.spec,
    get extent() {
      return cache.extent
    },
    ready(device) {
      const programs = horizonPrograms(device)
      let ready = programs.search(shape).ask().ready
      if (horizon.spatial) ready = programs.spatial.ask().ready && ready
      if (horizon.temporal) ready = programs.temporal.ask().ready && ready
      return programs.upsample.ask().ready && ready
    },
    draw(encoder, view, needed, image) {
      if (history.view !== view || image.historyCut || !horizon.temporal) {
        history.valid = false
        history.images = 0
      }
      history.view = view
      if (horizon.temporal) putMotion(scratch, image.before?.viewProjection, image.viewProjection)
      const ahead = passes[history.parity]
      drawPasses(ahead, scratch, settings, shape, history, encoder, view, needed, image)
      if (horizon.temporal) {
        history.valid = true
        history.images++
        history.parity = history.parity ? 0 : 1
        history.seen = image.frame
      }
      return view.textures.ao
    },
  }
}
