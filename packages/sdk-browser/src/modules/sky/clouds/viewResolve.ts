import { composedImage, writeComposeView } from './compose.ts'
import { COMPOSE_BINDING as C, COMPOSE_VIEW } from './composeWgsl.ts'
import { commitCloudView, writeReconstructView, type CloudFramePlan } from './reconstruct.ts'
import {
  RECONSTRUCT_BINDING as R,
  RECONSTRUCT_VIEW,
  readsHalfDepth,
  reconstructKind,
} from './reconstructWgsl.ts'
import { composeAirGroup, type CloudViewFrame } from './viewGroups.ts'
import { drawFullscreen, encodeDepthRange, encodeHaze, encodeTrace } from './viewFrame.ts'
import type { CloudDepthRange, CloudImages } from './viewTargets.ts'

/**
 * THE SECOND HALF OF AN IMAGE OF A VIEW'S CLOUDS, and the whole of it (`encodeCloudView`): the
 * reconstruction of the traced images with the last image's (`encodeReconstruct`) and the
 * composition over the lit image (`encodeCompose`), after the depth range, the trace and the haze
 * (`viewFrame.ts`).
 */

const reconstructWords = new Float32Array(new ArrayBuffer(RECONSTRUCT_VIEW.words * 4))
const composeWords = new Float32Array(new ArrayBuffer(COMPOSE_VIEW.words * 4))

/** The slot of the reconstructed image that is not `plan`'s destination: the last image's. */
const pastSlot = (plan: CloudFramePlan) => (plan.destination === 0 ? 1 : 0)

/** The reconstructed image of this image, written from the traced images and the last one; the
 *  traced images themselves in a mode that does not reconstruct. */
function encodeReconstruct(
  f: CloudViewFrame,
  traced: CloudImages,
  range: CloudDepthRange | undefined,
): CloudImages {
  const { plan, setup, gpu, programs } = f
  if (!setup.mode.reconstructs) return traced
  const past = plan.history ? gpu.reconstructedAt(pastSlot(plan)) : undefined
  const history = !!past
  const secondary = setup.minMaxDepth
  const dest = gpu.reconstructed(plan.destination, plan.sizes.reconstructed.texture, secondary)
  const pass = programs.reconstruct(setup, history)!
  const block = gpu.block('reconstruct', RECONSTRUCT_VIEW.words)
  writeReconstructView(
    reconstructWords,
    { ...f.camera, plan, state: gpu.state, preExposureRatio: f.preExposureRatio },
    f.part,
  )
  f.device.queue.writeBuffer(block, 0, reconstructWords)
  const half = readsHalfDepth(reconstructKind(setup, history)) ? range?.views.half : undefined
  const names = [block, traced.views.colour, traced.views.secondary, traced.views.depth]
  const pastNames = [past?.views.colour, past?.views.secondary, past?.views.depth, half]
  const group = gpu.group('reconstruct', pass.layout, [...names, ...pastNames], () => {
    const images = (set: CloudImages, c: number, s: number, d: number) => [
      { binding: c, resource: set.views.colour },
      ...(secondary ? [{ binding: s, resource: set.views.secondary! }] : []),
      { binding: d, resource: set.views.depth },
    ]
    return [
      { binding: R.view, resource: { buffer: block } },
      ...images(traced, R.colour, R.secondary, R.depth),
      ...(past ? images(past, R.historyColour, R.historySecondary, R.historyDepth) : []),
      ...(half ? [{ binding: R.halfDepth, resource: half }] : []),
      { binding: R.sampler, resource: programs.sampler },
    ]
  })
  const targets = [
    dest.views.colour,
    ...(secondary ? [dest.views.secondary!] : []),
    dest.views.depth,
  ]
  drawFullscreen(
    f,
    'Trillion3D cloud reconstruction',
    pass.pipeline.get(),
    [group],
    targets,
    plan.sizes.reconstructed.view,
  )
  return dest
}

/** The image `shown` laid over the lit image: its luminance added to the lit image multiplied by
 *  its transmittance. */
function encodeCompose(f: CloudViewFrame, shown: CloudImages) {
  const { gpu, programs, setup, plan } = f
  const pass = programs.compose(setup)
  const block = gpu.block('compose', COMPOSE_VIEW.words)
  const input = {
    image: composedImage(plan),
    setup,
    frameIndex: f.image.frameIndex,
    preExposure: f.image.preExposure,
  }
  writeComposeView(composeWords, input, f.part)
  f.device.queue.writeBuffer(block, 0, composeWords)
  const names = [block, shown.views.colour, shown.views.secondary, shown.views.depth, f.sceneDepth]
  const group = gpu.group('compose cloud', pass.layout, names, () => [
    { binding: C.view, resource: { buffer: block } },
    { binding: C.colour, resource: shown.views.colour },
    ...(setup.minMaxDepth ? [{ binding: C.secondary, resource: shown.views.secondary! }] : []),
    { binding: C.depth, resource: shown.views.depth },
    { binding: C.sceneDepth, resource: f.sceneDepth },
    { binding: C.sampler, resource: programs.sampler },
  ])
  const targets = [f.hdr]
  drawFullscreen(
    f,
    'Trillion3D cloud composition',
    pass.pipeline.get(),
    [composeAirGroup(f, pass.air), group],
    targets,
    f.view,
    true,
  )
}

/** Whether every program an image of `setup` needs is compiled, asked of the device where it is not;
 *  `hazed` says that the haze is laid by a pass of its own. */
export function cloudProgramsReady(
  programs: CloudViewFrame['programs'],
  setup: CloudViewFrame['setup'],
  key: CloudViewFrame['key'],
  hazed: boolean,
) {
  const ask = (pass: { pipeline: { ask(): { ready: boolean } } }) => pass.pipeline.ask().ready
  const ready = [ask(programs.trace(key)), ask(programs.compose(setup))]
  if (setup.depth === 'range')
    ready.push(ask(programs.depthRange('depth')), ask(programs.depthRange('range')))
  if (setup.depth === 'checkerboard') ready.push(ask(programs.depthRange('checkerboard')))
  if (hazed) ready.push(ask(programs.haze))
  if (setup.mode.reconstructs)
    ready.push(ask(programs.reconstruct(setup, false)!), ask(programs.reconstruct(setup, true)!))
  return ready.every(Boolean)
}

/**
 * One image of the clouds of a view, encoded on `f.encoder` over its lit image: the scene's depth
 * range, the trace, the haze per pixel where it is asked, the reconstruction and the composition.
 * The image's view-projection without jitter is the next one's history.
 */
export function encodeCloudView(f: CloudViewFrame) {
  const range = encodeDepthRange(f)
  const { traced, raw } = encodeTrace(f, range)
  if (raw) encodeHaze(f, traced, raw)
  const shown = encodeReconstruct(f, traced, range)
  encodeCompose(f, shown)
  commitCloudView(f.gpu.state, f.camera.viewProjection)
}
