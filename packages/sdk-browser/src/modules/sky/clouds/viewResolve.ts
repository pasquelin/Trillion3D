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
import type { HeldClouds } from './composeWgsl.ts'
import { drawFullscreenTriangle } from '../../../gpu/shader/fullscreenTriangle.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../../gpu/core/standIns.ts'
import { cloudPass, cloudSteps, encodeDepthRange, encodeHaze, encodeTrace } from './viewFrame.ts'
import type { CloudDepthRange, CloudImages } from './viewTargets.ts'
import { cloudShownOf } from './cloudShown.ts'

/**
 * THE SECOND HALF OF AN IMAGE OF A VIEW'S CLOUDS, and the whole of it (`encodeCloudView`): the
 * reconstruction of the traced images with the last image's (`encodeReconstruct`) and the
 * composition over the lit image (`encodeCompose`), after the depth range, the trace and the haze
 * (`viewFrame.ts`).
 */

/** The water's surface a composition binds where no water was shaded over the image: one texel, no water. */
const noWater = oncePerDevice((device) =>
  standInTexture(device, 'Trillion3D cloud no water', 'rgba8unorm').createView(),
)

const reconstructWords = new Float32Array(new ArrayBuffer(RECONSTRUCT_VIEW.words * 4))
const composeWords = new Float32Array(new ArrayBuffer(COMPOSE_VIEW.words * 4))

/** The slot of the reconstructed image that is not `plan`'s destination: the last image's. */
const pastSlot = (plan: CloudFramePlan) => (plan.destination === 0 ? 1 : 0)

/** The bindings of the reconstruction's group: its uniform, the traced images, the last one's
 *  where there is one, the half-resolution depth and the sampler. */
function reconstructEntries(
  held: {
    block: GPUBuffer
    traced: CloudImages
    past: CloudImages | undefined
    half: GPUTextureView | undefined
    secondary: boolean
  },
  sampler: GPUSampler,
) {
  const { block, traced, past, half, secondary } = held
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
    { binding: R.sampler, resource: sampler },
  ]
}

/** The reconstructed image of this image, written from the traced images and the last one, and with
 *  the fog laid on its colour where the translucent surfaces read it (`lateFogOnTranslucent`); the
 *  traced images themselves in a mode that does not reconstruct. */
function encodeReconstruct(
  f: CloudViewFrame,
  traced: CloudImages,
  range: CloudDepthRange | undefined,
): { image: CloudImages; fogged?: GPUTextureView } {
  const { plan, setup, gpu, programs } = f
  if (!setup.mode.reconstructs) return { image: traced }
  const past = plan.history ? gpu.reconstructedAt(pastSlot(plan)) : undefined
  const history = !!past
  const secondary = setup.minMaxDepth
  const dest = gpu.reconstructed(plan.destination, plan.sizes.reconstructed.texture, secondary)
  const pass = programs.reconstruct(setup, history)!
  const block = gpu.block('reconstruct', RECONSTRUCT_VIEW.words)
  writeReconstructView(
    reconstructWords,
    {
      ...f.camera,
      plan,
      state: gpu.state,
      preExposureRatio: f.preExposureRatio,
      preExposure: f.image.preExposure,
    },
    f.part,
  )
  f.device.queue.writeBuffer(block, 0, reconstructWords)
  const half = readsHalfDepth(reconstructKind(setup, history)) ? range?.views.half : undefined
  const names = [block, traced.views.colour, traced.views.secondary, traced.views.depth]
  const pastNames = [past?.views.colour, past?.views.secondary, past?.views.depth, half]
  const group = gpu.group('reconstruct', pass.layout, [...names, ...pastNames], () =>
    reconstructEntries({ block, traced, past, half, secondary }, programs.sampler),
  )
  const fogged = setup.lateFogOnTranslucent
    ? gpu.fogged(plan.sizes.reconstructed.texture).views.colour
    : undefined
  const targets = [
    dest.views.colour,
    ...(secondary ? [dest.views.secondary!] : []),
    dest.views.depth,
    ...(fogged ? [fogged] : []),
  ]
  const size = plan.sizes.reconstructed.view
  drawFullscreenTriangle(
    f.encoder,
    cloudPass('Trillion3D cloud reconstruction', targets),
    pass.pipeline.get(),
    pass.air ? [composeAirGroup(f, pass.air, 'reconstruct air'), group] : group,
    size.width,
    size.height,
  )
  return { image: dest, fogged }
}

/** The composition's uniform (`COMPOSE_VIEW`) for this image. */
function composeBlock(f: CloudViewFrame) {
  const block = f.gpu.block('compose', COMPOSE_VIEW.words)
  const input = {
    image: composedImage(f.plan),
    setup: f.setup,
    frameIndex: f.image.frameIndex,
    preExposure: f.image.preExposure,
  }
  writeComposeView(composeWords, input, f.part)
  f.device.queue.writeBuffer(block, 0, composeWords)
  return block
}

/** Group 1 of the composition: the uniform, the image `shown`, the scene's depth, the sampler and the water's surface. */
function imagesGroup(
  f: CloudViewFrame,
  layout: GPUBindGroupLayout,
  block: GPUBuffer,
  shown: CloudImages,
  water: GPUTextureView,
) {
  const names = [
    block,
    shown.views.colour,
    shown.views.secondary,
    shown.views.depth,
    f.sceneDepth,
    water,
  ]
  return f.gpu.group('compose cloud', layout, names, () => [
    { binding: C.view, resource: { buffer: block } },
    { binding: C.colour, resource: shown.views.colour },
    ...(f.setup.minMaxDepth ? [{ binding: C.secondary, resource: shown.views.secondary! }] : []),
    { binding: C.depth, resource: shown.views.depth },
    { binding: C.sceneDepth, resource: f.sceneDepth },
    { binding: C.sampler, resource: f.programs.sampler },
    { binding: C.water, resource: water },
  ])
}

/** The image `shown` laid over the lit image: its luminance added to the lit image multiplied by
 *  its transmittance. */
function encodeCompose(
  f: CloudViewFrame,
  block: GPUBuffer,
  shown: CloudImages,
  water: GPUTextureView,
) {
  const pass = f.programs.compose(f.setup)
  const group = imagesGroup(f, pass.layout, block, shown, water)
  const air = composeAirGroup(f, pass.air, 'compose air')
  drawFullscreenTriangle(
    f.encoder,
    cloudPass('Trillion3D cloud composition', [f.hdr], true),
    pass.pipeline.get(),
    [air, group],
    f.view.width,
    f.view.height,
  )
  // The alpha holdout: what the clouds, the haze and the fog in front of them hold out, added to the alpha
  // the first draw multiplied by the clouds' transmittance.
  if (!f.held) return
  const held = f.programs.compose(f.setup, f.held)
  drawFullscreenTriangle(
    f.encoder,
    cloudPass('Trillion3D cloud holdout', [f.hdr], true),
    held.pipeline.get(),
    [
      composeAirGroup(f, held.air, 'compose air held'),
      imagesGroup(f, held.layout, block, shown, water),
    ],
    f.view.width,
    f.view.height,
  )
}

/** Whether every program an image of `setup` needs is compiled, asked of the device where it is not;
 *  `hazed` says that the haze is laid by a pass of its own, `corners` that the empty-space table
 *  (the key's) reads the corners of its cells, `held` what the clouds hold out of the alpha. */
export function cloudProgramsReady(
  programs: CloudViewFrame['programs'],
  setup: CloudViewFrame['setup'],
  key: CloudViewFrame['key'],
  hazed: boolean,
  corners: boolean,
  held?: HeldClouds,
) {
  const ask = (pass: { pipeline: { ask(): { ready: boolean } } }) => pass.pipeline.ask().ready
  const ready = [ask(programs.trace(key)), ask(programs.compose(setup))]
  if (held) ready.push(ask(programs.compose(setup, held)))
  if (key.emptySpace) ready.push(ask(programs.emptySpace(corners)))
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
 * The image's view-projection without jitter is the next one's history. With `deferred` (an image
 * the single-layer water is shaded over), the composition is not encoded: it is returned, to be called
 * once the water is shaded, with the texture whose alpha says where the water lies (none where it was
 * not drawn), so that the clouds in front of the water lie over it and the pixels it covers take the
 * clouds that are before its surface.
 */
export function encodeCloudView(f: CloudViewFrame, deferred = false) {
  const range = encodeDepthRange(f)
  cloudSteps.begin(f.encoder)
  const { traced, raw } = encodeTrace(f, range)
  if (raw) encodeHaze(f, traced, raw)
  cloudSteps.end()
  const { image: shown, fogged } = encodeReconstruct(f, traced, range)
  const block = composeBlock(f)
  // The translucent surfaces read the image that was rebuilt or traced: with the fog laid on it
  // where the setup asks. A direct trace has no image to read.
  f.gpu.shown = f.setup.direct ? undefined : cloudShownOf(f, shown, fogged ?? shown.views.colour)
  commitCloudView(f.gpu.state, f.camera.viewProjection)
  if (!deferred) {
    encodeCompose(f, block, shown, noWater(f.device))
    return undefined
  }
  return (water?: GPUTextureView) => encodeCompose(f, block, shown, water ?? noWater(f.device))
}
