import { skyLightReadOf } from '../../../frame/render/encodeSkyLight.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/contractLight.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'
import { hizSetting } from '../../../visibility/hiz/setting.ts'
import { screenRelativeThickness } from '../../../visibility/hiz/gpu/screenSlab.ts'
import { lightFunctionResources } from '../../lightFunction/frame.ts'
import { reflectionGroup, reflectionLightView, reflectionProxy } from '../../reflections/group.ts'
import { encodeScreenProbes as encodePass } from './encode.ts'
import { createScreenProbeGroups } from './groups.ts'
import type { ScreenProbeInputs } from './groupParts.ts'
import { createScreenProbeStore, type ScreenProbeStore } from './store.ts'
import type { ScreenProbeGeometry } from './screenProbeLayout.ts'
import { ensureScreenProbeView, imageGeometry, type ScreenProbeView } from './view.ts'
import { screenProbeVectors } from './vectorSource.ts'

/** The metrics of an image of `settings`: what it cast — `geometry`, with what it read — or, with none, why it cast none. */
function metricsOf(
  settings: ScreenProbeSettings,
  geometry: ScreenProbeGeometry | undefined,
  read: { history?: boolean; screen?: boolean; velocity?: boolean; bytes?: number },
  unavailable: string | null,
): ScreenProbeFrameMetrics {
  const g = geometry
  return {
    level: settings.level,
    tile: g?.tile ?? settings.downsampleFactor,
    uniformProbes: g?.uniform ?? 0,
    adaptiveCapacity: g?.maxAdaptive ?? 0,
    tracingResolution: settings.tracingResolution,
    raysPerImage: g ? (g.uniform + g.maxAdaptive) * g.tracing * g.tracing : 0,
    atlas: g ? [g.tilesX, g.rows] : [0, 0],
    history: !!read.history,
    screenTraces: !!read.screen && settings.screenTraces,
    sceneTraces: !!g && settings.sceneTraces,
    meshTraces: !!g && settings.sceneTraces && settings.meshTraces,
    velocity: !!read.velocity,
    bytes: read.bytes ?? 0,
    unavailable,
  }
}

/** What an image needs of the frame to cast probes, or nothing while the frame lacks any of it: the device, the
 *  reflection (its depth pyramid, its last lit image, its view), the G-buffer, the lights and the lighting. */
function neededOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, lights, run } = rt
  const { device, reflection, surfaces, deferred } = gpu
  const depth = vis.gpuHiz?.depth(),
    lightView = reflectionLightView(rt)
  if (
    !device ||
    !reflection ||
    !surfaces ||
    !deferred ||
    !depth ||
    !lightView ||
    !vis.reflectionPipelines ||
    !lights.buffer ||
    !run.depthDrawn ||
    !wantsContractLighting(rt) ||
    !drawsLit(run.diagnostic)
  )
    return undefined
  return { device, reflection, surfaces, deferred, depth, lightView, lights: lights.buffer }
}

/** The frame's resources the probes read, handed to `castProbes`. */
type Needed = NonNullable<ReturnType<typeof neededOf>>

/** What the groups name of the frame: its normals and flags, the lights and their lists, the cascades (or the
 *  lighting's stand-ins), the proxy the rays walk, the light functions' atlas and the vectors of the image (or the
 *  stand-in of none). */
function inputsOf(
  rt: WebgpuPagesRuntime,
  { device, surfaces, deferred, lights }: Needed,
  store: ScreenProbeStore,
  vectors: GPUTextureView | undefined,
): ScreenProbeInputs {
  const frames = surfaces.views(),
    probes = rt.bounce.probes
  return {
    normals: frames[1],
    flags: frames[3],
    lights,
    lightLists: rt.lights.tiles?.buffer ?? deferred.placeholders.tiles,
    bounceGrid: probes?.uniform ?? deferred.placeholders.bounceGrid,
    probes: probes?.probes ?? deferred.placeholders.probes,
    proxy: reflectionProxy(rt)!,
    lightFunction:
      lightFunctionResources(rt, 'lightFunctionBounce') ?? deferred.placeholders.lightFunction,
    vectors: vectors ?? store.noVectors(device),
  }
}

/** The groups of the view for the kernels and the filter's passes asked: made again where either changed, the history dropped where the
 *  passes' parity did (the rays read the gathered texture the last passes wrote). */
function groupsOf(
  view: ScreenProbeView,
  device: GPUDevice,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
) {
  const parity = settings.spatialFilterPasses & 1
  if (view.kernels !== kernels || view.parity !== parity) {
    if (view.parity !== undefined && view.parity !== parity) view.history = false
    view.kernels = kernels
    view.parity = parity
    view.groups = createScreenProbeGroups(
      device,
      kernels,
      view.resources,
      settings.spatialFilterPasses,
    )
  }
  return view.groups!
}

/**
 * One image of probes, over the frame's resources: the inputs the groups name, the history read only where the
 * last image of the view left one drawn with the view-projection the last lit image holds, at the same size,
 * the surfaces' vectors of this image read with it, the parameters written, the pass encoded, and the result
 * handed to the lighting; what it cast is the result.
 */
function castProbes(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  needed: Needed,
  store: ScreenProbeStore,
  state: ScreenProbeView,
  kernels: NonNullable<ScreenProbeView['kernels']>,
  settings: ScreenProbeSettings,
) {
  const { device, reflection, depth, lightView } = needed
  const vectors = screenProbeVectors(rt)
  const groups = groupsOf(state, device, kernels, settings)
  const { held } = reflection.radiance
  const geometry = imageGeometry(state, rt.gpu.targetSize, settings)
  const history =
    state.history &&
    held.valid &&
    held.size[0] === geometry.width &&
    held.size[1] === geometry.height &&
    sameValues(held.viewProjection, state.viewProjection)
  const screen = reflection.frame.depthDrawn && held.valid
  const velocity = history && !!vectors
  invertMatrix4(state.previousInverse, held.viewProjection)
  state.write(geometry, settings, {
    frame: state.frame,
    history,
    screen,
    field: !!rt.bounce.probes,
    velocity,
    previousInverse: state.previousInverse,
    relativeThickness: screenRelativeThickness(
      reflection.frame.viewProjection,
      settings.relativeDepthThickness,
    ),
    fullResDepth: hizSetting(rt, 'hizFullResDepth'),
  })
  encodePass(encoder, {
    kernels,
    resources: state.resources,
    groups: groups(state.turn, inputsOf(rt, needed, store, vectors)),
    reflection: reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)),
    settings,
  })
  state.indirect = state.resources.history[state.turn]
  state.viewProjection.set(reflection.frame.viewProjection)
  state.history = true
  state.turn = (1 - state.turn) as 0 | 1
  state.frame++
  return metricsOf(settings, geometry, { history, screen, velocity, bytes: state.bytes }, null)
}

/** The view's probes given back, and the lighting left none to read. */
function release(rt: WebgpuPagesRuntime) {
  rt.gpu.screenProbes?.dispose()
  rt.gpu.screenProbes = undefined
}

/**
 * THE SCREEN PROBES OF THE IMAGE (`encodeScreenProbes`), after the depth pyramid and the reflections — which made the view's
 * uniform and hold the last lit image — and before the lighting, which reads what they leave (`ScreenProbeView.indirect`, named
 * by `directLightResources`). An image that cannot cast them — no lit surface, kernels still compiling, a device that refused
 * them, a budget with no room — leaves the lighting none: its pixels then read the world's probes, as they did before the screen
 * probes. A level `'off'`, or no bounce, gives the view's probes back altogether.
 */
export function encodeScreenProbes(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { bounce, gpu } = rt
  const store = (bounce.screen ??= createScreenProbeStore())
  const settings = store.read(rt.context)
  if (!settings.enabled || !bounce.wanted) {
    release(rt)
    store.metrics = undefined
    return
  }
  const skip = (why: string) => {
    if (gpu.screenProbes) {
      gpu.screenProbes.indirect = undefined
      gpu.screenProbes.history = false
    }
    store.metrics = metricsOf(settings, undefined, { bytes: gpu.screenProbes?.bytes }, why)
  }
  const needed = neededOf(rt)
  if (!needed) return skip('no lit image to cast the probes on')
  const kernels = store.kernelsFor(needed.device, settings)
  if (!kernels) return skip(store.reason ?? 'the screen probes are compiling')
  const { view, why } = ensureScreenProbeView(
    gpu.screenProbes,
    needed.device,
    gpu.allocatedSize,
    settings,
  )
  gpu.screenProbes = view
  if (!view) return skip(why!)
  store.metrics = castProbes(rt, encoder, needed, store, view, kernels, settings)
}

/** Asks the screen probes' kernels of the device at a frame's entry, off the frame, once the image is lit by the probes' level: the
 *  frames wait for them (`track`), showing the previous image, never compiling a kernel themselves. */
export function askScreenProbes(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { bounce } = rt
  if (!bounce.wanted || !wantsContractLighting(rt)) return
  const store = (bounce.screen ??= createScreenProbeStore())
  const settings = store.read(rt.context)
  if (settings.enabled) store.kernelsFor(device, settings)
}
