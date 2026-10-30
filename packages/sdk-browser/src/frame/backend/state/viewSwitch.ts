import { tradeCamera, tradeView } from '../../view/viewTrade.ts'
import { releaseTargets } from '../../prepare/targets.ts'
import { disposeFogVolume } from '../../render/encodeFogVolume.ts'
import { disposeTranslucencyVolume } from '../../../lighting/translucency/frame.ts'
import { disposeTranslucencyGi } from '../../../lighting/translucencyGi/frame.ts'
import { disposeLocalFog } from '../../render/localFogGpu.ts'
import { disposeLightShafts } from '../../../modules/sky/lightShafts/frame.ts'
import { disposeCloudView } from '../../../modules/sky/clouds/viewTargets.ts'
import { disposeHairView } from '../../../hair/frame.ts'
import { releaseSampledLightsView } from '../../../lighting/manyLightsSampled/release.ts'
import { releaseViewVolumes } from '../../../lighting/heterogeneousVolumes/liveShadingState.ts'
import { releaseFirstPersonSelfShadow } from '../../../lighting/shadows/firstPerson/selfShadow.ts'
import { releaseScreenSpaceTracing } from '../../../lighting/screenSpaceTracing/stage.ts'
import { releaseShadowDenoise } from '../../../lighting/shadows/denoise/shadowDenoiseFrame.ts'
import { releaseRayTracedLocal } from '../../../lighting/shadows/rayTraced/rayTracedLocal.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { viewKey } from './viewKey.ts'
import { disposeViewStates } from './viewState.ts'
import {
  VIEW_GPU_KEYS,
  VIEW_RUN_KEYS,
  VIEW_TIMING_KEYS,
  VIEW_VIS_KEYS,
  viewGpu,
  type WebgpuView,
} from './view.ts'

/**
 * The one place a view is switched: every reader goes through the runtime groups, and they hold
 * `view`'s state once this returns. References are traded, nothing is allocated and the device is
 * asked nothing. Each view keeps its own held-frame witness and Hi-Z pyramid, so drawing one never
 * breaks another's hold; the host lists the last image published are read anew, since they
 * described another view's cut.
 */
export function useWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const { views, run, gpu, vis, setup, timing } = rt,
    from = views.active
  if (from === view) return
  tradeView(run, from.run, view.run, VIEW_RUN_KEYS)
  tradeView(gpu, from.gpu, view.gpu, VIEW_GPU_KEYS)
  tradeView(vis, from.vis, view.vis, VIEW_VIS_KEYS)
  tradeView(timing, from.timing, view.timing, VIEW_TIMING_KEYS)
  // The arrays are traded, never copied: the host's, which its resizes write, stays the main
  // view's, and a resize during a capture is not undone when the main view comes back.
  from.viewport = setup.viewport
  setup.viewport = view.viewport
  views.active = view
  tradeCamera(run.gate, from, view)
  from.hold = run.gate.useViewHold(view.hold)
  // Hi-Z dropped while `view` was aside: the pyramid it kept goes too.
  from.hiz = vis.gpuHiz?.swap(view.hiz)
  if (!vis.gpuHiz) view.hiz?.destroy()
  view.hiz = undefined
  run.pendingHeld.cut = run.ranksHeld.cut = -1
}

/** Runs `work` on `arg` with `view` drawn — a late answer of the device lands on the view that
 *  asked for it — then draws again the view that was. A `work` made once, handed what it reads,
 *  costs a frame no closure. */
export function onView<T, A = undefined>(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  work: (rt: WebgpuPagesRuntime, arg: A) => T,
  arg?: A,
) {
  const back = rt.views.active
  useWebgpuView(rt, view)
  try {
    return work(rt, arg as A)
  } finally {
    useWebgpuView(rt, back)
  }
}

/** The passes every view makes its image with, released: the temporal pass, the velocity stage,
 *  the exposure, the finishing, the effects, the screen probes, the ambient occlusion, the
 *  subsurface scattering, the screen-space traces, the shadow denoiser, the traced lights, the first-person self shadow, the sampled lighting's state of the view, and the view's fog,
 *  translucency, light shafts, clouds and hair. */
export function disposeViewPasses(gpu: WebgpuView['gpu']) {
  gpu.temporal?.dispose()
  gpu.velocity?.dispose()
  gpu.exposure?.dispose()
  gpu.finish?.dispose()
  gpu.effects?.dispose()
  gpu.screenProbes?.dispose()
  gpu.ambientOcclusion?.dispose()
  gpu.subsurface?.dispose()
  gpu.temporal = gpu.velocity = gpu.exposure = undefined
  gpu.finish = gpu.effects = gpu.screenProbes = gpu.ambientOcclusion = gpu.subsurface = undefined
  // What the commands of this image already encoded may still name is retired, never destroyed at once, on the device each state holds.
  releaseScreenSpaceTracing(gpu)
  releaseSampledLightsView(gpu)
  releaseViewVolumes(gpu)
  // The states the stages keep by view (`viewState`) go, each by its own disposer.
  disposeViewStates(gpu)
  releaseShadowDenoise(gpu)
  releaseRayTracedLocal(gpu)
  releaseFirstPersonSelfShadow(gpu)
  disposeFogVolume(gpu)
  disposeTranslucencyVolume(gpu)
  disposeTranslucencyGi(gpu)
  disposeLocalFog(gpu)
  disposeLightShafts(gpu)
  disposeCloudView(gpu)
  disposeHairView(gpu)
}

/** Releases the targets of `view`, which is not the main one, its own pyramid, history, effect
 *  chain, cut, timer and canvas, and takes its cut out of what the residency holds; the view drawn
 *  before is drawn again — the main one when it was `view` —, so a capture under way keeps its
 *  own. */
export function releaseWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const back = rt.views.active === view ? rt.views.main : rt.views.active
  useWebgpuView(rt, view)
  releaseTargets(rt)
  useWebgpuView(rt, back)
  view.hiz?.destroy()
  view.hiz = undefined
  disposeViewPasses(view.gpu)
  rt.blendState.expand?.releaseVerdict(viewKey(view.gpu))
  // A canvas of its own is withdrawn; the main view's, which a view placed on it presents into,
  // stays.
  if (view.gpu.presenter !== viewGpu(rt, rt.views.main).presenter) view.gpu.presenter?.dispose()
  view.gpu.presenter = undefined
  view.timing.gpuTiming?.dispose()
  view.timing.gpuTiming = undefined
  // Its cut's readback slots go with it (`../../../geometry/dag/aside.ts`).
  view.run.asideCut?.dispose()
  view.run.asideCut = undefined
  // The shadow cache entries it kept under its identity (`WebgpuView.id`; the main view's, '', stay).
  if (view.id) rt.lights.vsm?.state.cache.dropView(view.id)
  rt.services.releaseView(view)
}
