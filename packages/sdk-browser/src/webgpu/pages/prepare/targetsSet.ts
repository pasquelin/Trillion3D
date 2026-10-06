import { tradeView } from '../../../frame/viewTrade.ts'
import { disposeBackdrop } from '../../transparent/transmission.ts'
import type { DeviceGrant } from '../../../gpu/core/errorScope.ts'
import type { HizPyramid } from '../../../gpu/hiz/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { WebgpuGpuState } from '../state/gpu.ts'
import type { WebgpuVisState } from '../state/vis.ts'
import type { FrameSize } from '../state/renderScale.ts'
import type { WebgpuView } from '../state/view.ts'

/** The members of the frame targets (`makeTargets`), in the runtime's groups: what a set made
 *  beside those in place trades with them whole (`targetsAside.ts`), as a view switch trades a
 *  view's (`VIEW_GPU_KEYS`). */
const SET_GPU_KEYS = [
  'colorTexture',
  'colorView',
  'depthTexture',
  'depthView',
  'hdrTexture',
  'hdrView',
  'displayTexture',
  'displayView',
  'feedbackTexture',
  'feedbackView',
  'backdrop',
  'reflection',
  'surfaces',
  'asIsShare',
  'displayFilter',
  'targetSize',
  'allocatedSize',
  'displaySize',
  'targetBytes',
] as const satisfies readonly (keyof WebgpuGpuState)[]
const SET_VIS_KEYS = [
  'visTexture',
  'visView',
  'gpuRaster',
] as const satisfies readonly (keyof WebgpuVisState)[]

/** One set of frame targets held outside the runtime's groups. */
export interface TargetSet {
  gpu: Pick<WebgpuGpuState, (typeof SET_GPU_KEYS)[number]>
  vis: Pick<WebgpuVisState, (typeof SET_VIS_KEYS)[number]>
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
  tradeView(rt.vis, into.vis, next.vis, SET_VIS_KEYS)
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

/** Targets asked beside those in place (`targetsAside.ts`): the view that asked, the sizes and
 *  bytes asked, the set and the Hi-Z pyramid made — none where the render size stays —, whether
 *  the device granted them, and whether a release dropped them meanwhile. */
export type AsideTargets = FrameSize & {
  view: WebgpuView
  requestedBytes: number
  set?: TargetSet
  hiz?: HizPyramid
  granted: boolean
  dropped: boolean
}
/** Those targets as asked of the device, `settled` once it answered. */
export type Aside = AsideTargets & DeviceGrant

/** The targets a runtime made aside, one at a time: those of its main view. */
export const asides = new WeakMap<WebgpuPagesRuntime, Aside>()

/** Frees what `aside` made: refused, dropped, or never to be swapped in. */
export function destroyAside(aside: AsideTargets) {
  if (aside.set) releaseSet(aside.set.gpu, aside.set.vis)
  aside.hiz?.destroy()
  aside.set = aside.hiz = undefined
  aside.granted = false
}

/** The drawn view's targets made aside go: freed now, or as they land. */
export function dropAside(rt: WebgpuPagesRuntime) {
  const aside = asides.get(rt)
  if (!aside || aside.view !== rt.views.active) return
  asides.delete(rt)
  aside.dropped = true
  destroyAside(aside)
}
