import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { createViewFilter } from '../../geometry/selection/viewFilter.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { appendRootsUnder } from './movedNode.ts'
import { hiddenFromViews } from './hiddenFromViews.ts'
import { hzbOccludedRanks } from '../../visibility/hzbOcclusion/occludedRoots.ts'
import { writeViewClipPlaneAtEye } from './viewClip.ts'
import { lowestBit } from '../../../../math/src/scalar/bits.ts'

/** The filter of each view, held beside the uniforms of its cut: a view's own object. */
const filters = new WeakMap<SelectionUniforms, ReturnType<typeof createViewFilter>>()
/** The bits of each filter the shadows' casters follow: those without the roots the view's occlusion test hides (`createViewFilter().base`). */
const bases = new WeakMap<SelectionUniforms, Uint32Array | undefined>()

/** The bits the shadows' casters of the view of `uniforms` follow: its filter's but for the roots its occlusion test hides,
 *  which still cast; none when the view filters nothing. */
export const castersFilter = (uniforms: SelectionUniforms) => bases.get(uniforms)

/**
 * What a view carries beside its eye, written into its cut's uniforms (`Camera.clipPlane`,
 * `Camera.hidden`, `Camera.showOnly`, `Camera.owner`,
 * `../../../../sdk-core/src/contracts/viewOptions.ts`): its
 * clip plane in the render frame — the world plane's offset taken to the eye, in double, then
 * single (`writeViewClipPlaneAtEye`) —, all zero unless the project switch is on and the view has
 * one; its filter's bits (`../../geometry/selection/viewFilter.ts`), when the host allows filters
 * (`filtering`) and the view lists any. A view with neither writes zeros and no bits.
 */
export function writeCutViewSet(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  uniforms: SelectionUniforms,
  filtering: boolean,
) {
  const { hidden, showOnly, owner } = cam.viewSet
  writeViewClipPlaneAtEye(rt, cam, uniforms.clipPlane, 0)
  const before = uniforms.filter
  let filter = filters.get(uniforms)
  // The roots the view does not draw whatever its lists say, the host's switch on lists apart: those its
  // owner does not see among them.
  // The custom depth's view follows the main view's rules (the stand-ins of first-person objects are left out), and leaves out as well
  // every root whose object does not ask for it (`ViewOverrides.customDepthCapture`).
  const custom = rt.views.active.overrides.customDepthCapture
  const viewed = hiddenFromViews(rt, rt.views.active === rt.views.main || !!custom, owner)
  const forced = custom?.hidden(viewed) ?? viewed
  // The main view alone is tested against the depth it drew (`hzbOccludedRanks`).
  const occluded = rt.views.active === rt.views.main ? hzbOccludedRanks(rt) : undefined
  const listed = filtering && (hidden.length > 0 || showOnly !== null)
  if (!listed && !forced.length && !occluded?.length && (!filtering || !filter)) {
    uniforms.filter = undefined
    if (before) staleCasters(rt, bases.get(uniforms), undefined)
    bases.delete(uniforms)
    return
  }
  if (!filter) filters.set(uniforms, (filter = createViewFilter()))
  const { layout, run } = rt
  uniforms.filter = filter.update(
    filtering ? cam.viewSet : undefined,
    layout.selectionRoots.length,
    (node, out, at) => appendRootsUnder(layout, node, out, at),
    run.gate.revisions.scene,
    forced,
    occluded,
  )
  const base = filter.base()
  if (base !== bases.get(uniforms)) staleCasters(rt, bases.get(uniforms), base)
  bases.set(uniforms, base)
}

/**
 * The placements whose bit differs between two filters' bits — one the view has and the other has
 * not, or a filter that came or went — cast otherwise into the view's shadows from now on: their
 * mobility is touched, as for a placement shown or hidden (`../../placement/webgpuPlacements.ts`,
 * `flipWorld`).
 */
function staleCasters(
  rt: WebgpuPagesRuntime,
  before: Uint32Array | undefined,
  after: Uint32Array | undefined,
) {
  const words = Math.max(before?.length ?? 0, after?.length ?? 0)
  for (let k = 0; k < words; k++) {
    let differ = (before?.[k] ?? 0) ^ (after?.[k] ?? 0)
    while (differ !== 0) {
      const rank = (k << 5) | lowestBit(differ)
      rt.lights.mobility.touch(rank)
      differ &= differ - 1
    }
  }
}
