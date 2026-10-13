import { tradeView } from '../../../frame/viewTrade.ts'
import { disposeBackdrop } from '../../transparent/transmission.ts'
import type { DeviceGrant } from '../../../gpu/core/errorScope.ts'
import type { HizPyramid } from '../../../gpu/hiz/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { WebgpuGpuState } from '../state/gpu.ts'
import type { WebgpuVisState } from '../state/vis.ts'
import type { FrameSize } from '../state/renderScale.ts'
import { TARGET_GPU_KEYS, VIEW_VIS_KEYS } from '../state/view.ts'

/** The members of the frame targets (`makeTargets`), in the runtime's groups: what a set made
 *  beside those in place trades with them whole (`targetsAside.ts`), as a view switch trades a
 *  view's (`VIEW_GPU_KEYS`). */
const SET_GPU_KEYS = [
  ...TARGET_GPU_KEYS,
  'asIsShare',
  'displayFilter',
] as const satisfies readonly (keyof WebgpuGpuState)[]

/** One set of frame targets held outside the runtime's groups. */
export interface TargetSet {
  gpu: Pick<WebgpuGpuState, (typeof SET_GPU_KEYS)[number]>
  vis: Pick<WebgpuVisState, (typeof VIEW_VIS_KEYS)[number]>
}

/** A set holding no target: traded in, it empties the groups. */
export const emptySet = () => ({ gpu: {}, vis: {} }) as TargetSet

/** Puts `next`'s targets in the runtime's groups, and those they held into `into`: references
 *  traded, nothing made, nothing asked of the device. */
export function tradeSet(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'vis'>,
  into: TargetSet,
  next: TargetSet,
) {
  tradeView(rt.gpu, into.gpu, next.gpu, SET_GPU_KEYS)
  tradeView(rt.vis, into.vis, next.vis, VIEW_VIS_KEYS)
}

/** Destroys the targets `gpu` and `vis` hold — the runtime's groups or a set's —, their members
 *  emptied. */
export function releaseSet(gpu: TargetSet['gpu'], vis: TargetSet['vis']) {
  const textures = [gpu.colorTexture, gpu.depthTexture, gpu.hdrTexture, gpu.feedbackTexture]
  if (gpu.displayTexture !== gpu.colorTexture) textures.push(gpu.displayTexture)
  for (const texture of [...textures, vis.visTexture]) texture?.destroy()
  gpu.colorTexture = gpu.depthTexture = gpu.hdrTexture = gpu.feedbackTexture = undefined
  gpu.colorView = gpu.depthView = gpu.hdrView = gpu.feedbackView = undefined
  gpu.displayTexture = gpu.displayView = undefined
  gpu.targetBytes = 0
  vis.visTexture = undefined
  vis.visView = undefined
  disposeBackdrop(gpu as WebgpuGpuState)
  gpu.reflection?.dispose()
  gpu.reflection = undefined
  gpu.surfaces?.dispose()
  gpu.surfaces = undefined
  gpu.asIsShare?.dispose()
  gpu.asIsShare = undefined
  gpu.displayFilter?.dispose()
  gpu.displayFilter = undefined
  vis.gpuRaster?.dispose()
  vis.gpuRaster = undefined
}

/** The sizes and bytes a grant asks of the device. */
export type AskedTargets = FrameSize & { requestedBytes: number }

/** Targets asked the held way (`targetGrant.ts`): those in place released, the frames held until
 *  the device answers; refused, `retryAt` is the frame this size may be asked again at. */
export type HeldTargets = AskedTargets & { mode: 'held'; retryAt?: number }

/** Targets asked beside those in place (`targetsAside.ts`): the set and the Hi-Z pyramid made —
 *  none where the render size stays —, whether the device granted them, and whether a release
 *  dropped them meanwhile. */
export type AsideTargets = AskedTargets & {
  mode: 'aside'
  set?: TargetSet
  hiz?: HizPyramid
  granted: boolean
  dropped: boolean
}

/** The one grant of frame targets a view has in flight, or refused, on its `gpu.targetGrant`:
 *  asked the held way or aside, `settled` once the device answered. */
export type TargetGrant = (HeldTargets | AsideTargets) & DeviceGrant

/** Frees what `aside` made: refused, dropped, or never to be swapped in. */
export function destroyAside(aside: AsideTargets) {
  if (aside.set) releaseSet(aside.set.gpu, aside.set.vis)
  aside.hiz?.destroy()
  aside.set = aside.hiz = undefined
  aside.granted = false
}

/** The drawn view's targets made aside go: freed now, or as they land. */
export function dropAside(rt: WebgpuPagesRuntime) {
  const aside = rt.gpu.targetGrant
  if (aside?.mode !== 'aside') return
  rt.gpu.targetGrant = undefined
  aside.dropped = true
  destroyAside(aside)
}
