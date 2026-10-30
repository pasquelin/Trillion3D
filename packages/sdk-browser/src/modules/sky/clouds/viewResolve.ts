import { composedImage, writeComposeView, type ComposeKind } from './compose.ts'
import { COMPOSE_BINDING as C, COMPOSE_VIEW } from './composeWgsl.ts'
import { commitCloudView, writeReconstructView, type CloudFramePlan } from './reconstruct.ts'
import {
  RECONSTRUCT_BINDING as R,
  RECONSTRUCT_VIEW,
  readsHalfDepth,
  reconstructKind,
} from './reconstructWgsl.ts'
import { composeAirGroup, type CloudViewFrame } from './viewGroups.ts'
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
function composeBlock(f: CloudViewFrame, waterFactor = 0) {
  const block = f.gpu.block(waterFactor ? 'composeBehindWater' : 'compose', COMPOSE_VIEW.words)
  const input = {
    image: composedImage(f.plan),
    // A debug view of the tracing is laid with no fog.
    setup: f.key.debugView === 0 ? f.setup : { ...f.setup, lateFog: false },
    frameIndex: f.image.frameIndex,
    preExposure: f.image.preExposure,
    waterFactor,
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
  slot = 'compose cloud',
  sceneDepth = f.sceneDepth,
) {
  const names = [
    block,
    shown.views.colour,
    shown.views.secondary,
    shown.views.depth,
    sceneDepth,
    water,
  ]
  return f.gpu.group(slot, layout, names, () => [
    { binding: C.view, resource: { buffer: block } },
    { binding: C.colour, resource: shown.views.colour },
    ...(f.setup.minMaxDepth ? [{ binding: C.secondary, resource: shown.views.secondary! }] : []),
    { binding: C.depth, resource: shown.views.depth },
    { binding: C.sceneDepth, resource: sceneDepth },
    { binding: C.sampler, resource: f.programs.sampler },
    { binding: C.water, resource: water },
  ])
}

/** A debug view of a direct trace shows in place of the lit image (no blend: the reference does not blend its colour), the others are
 *  laid over it. */
const composeKindOf = (setup: CloudViewFrame['setup'], key: CloudViewFrame['key']): ComposeKind =>
  setup.direct && key.debugView !== 0 ? 'replace' : 'over'

/** The image `shown` laid over the lit image: its luminance added to the lit image multiplied by
 *  its transmittance. */
function encodeCompose(
  f: CloudViewFrame,
  block: GPUBuffer,
  shown: CloudImages,
  water: GPUTextureView,
) {
  const pass = f.programs.compose(f.setup, composeKindOf(f.setup, f.key))
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
  // The alpha holdout: what the clouds, the haze and the fog in front of them hold out, as the trace wrote it,
  // added to the alpha the first draw multiplied by the clouds' transmittance. The image it is enlarged from
  // takes the place of the cloud colour.
  if (!f.key.holdout) return
  const held = f.programs.compose(f.setup, 'holdout')
  const coverage = f.gpu.holdout(composedImage(f.plan).texture)
  const heldImage = { ...shown, views: { ...shown.views, colour: coverage.views.colour } }
  drawFullscreenTriangle(
    f.encoder,
    cloudPass('Trillion3D cloud holdout', [f.hdr], true),
    held.pipeline.get(),
    [
      composeAirGroup(f, held.air, 'compose air held'),
      imagesGroup(f, held.layout, block, heldImage, water, 'compose holdout'),
    ],
    f.view.width,
    f.view.height,
  )
}

/** The image `shown` laid over the scene copy behind the water, `target` of `width` by `height` texels, `depth` its linear depth, `factor` times fewer pixels a side
 *  than the image (`VolumetricComposeOverScene` under the water): the clouds the water refracts. Nothing while its program compiles. */
function encodeComposeBehindWater(
  f: CloudViewFrame,
  shown: CloudImages,
  target: GPUTextureView,
  depth: GPUTextureView,
  width: number,
  height: number,
  factor: number,
) {
  const pass = f.programs.compose(f.setup, 'behindWater')
  const block = composeBlock(f, factor)
  drawFullscreenTriangle(
    f.encoder,
    cloudPass('Trillion3D cloud composition behind water', [target], true),
    pass.pipeline.get(),
    [
      composeAirGroup(f, pass.air, 'compose air behind water'),
      imagesGroup(f, pass.layout, block, shown, noWater(f.device), 'compose behind water', depth),
    ],
    width,
    height,
  )
}

/** Whether every program an image of `setup` needs is compiled, asked of the device where it is not;
 *  `hazed` says that the haze is laid by a pass of its own, and `corners` that the empty-space table
 *  (the key's) reads the corners of its cells. With `water` (the image is shaded over by single-layer water), the composition behind the
 *  water is asked ahead too, without being waited for: an image never waits on it, it is only compiled by the time a camera needs it. */
export function cloudProgramsReady(
  programs: CloudViewFrame['programs'],
  setup: CloudViewFrame['setup'],
  key: CloudViewFrame['key'],
  hazed: boolean,
  corners: boolean,
  water = false,
) {
  const ask = (pass: { pipeline: { ask(): { ready: boolean } } }) => pass.pipeline.ask().ready
  const ready = [ask(programs.trace(key)), ask(programs.compose(setup, composeKindOf(setup, key)))]
  if (key.holdout) ready.push(ask(programs.compose(setup, 'holdout')))
  if (key.emptySpace) ready.push(ask(programs.emptySpace(corners)))
  if (setup.depth === 'range')
    ready.push(ask(programs.depthRange('depth')), ask(programs.depthRange('range')))
  if (setup.depth === 'checkerboard') ready.push(ask(programs.depthRange('checkerboard')))
  if (hazed) ready.push(ask(programs.haze))
  if (water) ask(programs.compose(setup, 'behindWater'))
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
 * clouds that are before its surface; with it comes the composition into the scene copy behind the water
 * (`behindWater`, for a camera that may intersect the water), called once that copy is made.
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
  // A debug view replaces the clouds, so the translucent surfaces read none.
  f.gpu.shown =
    f.setup.direct || f.key.debugView !== 0
      ? undefined
      : cloudShownOf(f, shown, fogged ?? shown.views.colour)
  commitCloudView(f.gpu.state, f.camera.viewProjection)
  if (!deferred) {
    encodeCompose(f, block, shown, noWater(f.device))
    return undefined
  }
  return {
    compose: (water?: GPUTextureView) => encodeCompose(f, block, shown, water ?? noWater(f.device)),
    behindWater: (
      target: GPUTextureView,
      depth: GPUTextureView,
      width: number,
      height: number,
      factor: number,
    ) => encodeComposeBehindWater(f, shown, target, depth, width, height, factor),
  }
}
