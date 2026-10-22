import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { createViewFilter } from '../../geometry/selection/viewFilter.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { appendRootsUnder } from './movedNode.ts'
import { deriveRootRows } from '../../placement/rows/rowWords.ts'
import { writeViewClipPlaneAtEye } from './viewClip.ts'
import { lowestBit } from '../../../../math/src/scalar/bits.ts'

/** The filter of each view, held beside the uniforms of its cut: a view's own object. */
const filters = new WeakMap<SelectionUniforms, ReturnType<typeof createViewFilter>>()

/**
 * What a view carries beside its eye, written into its cut's uniforms (`Camera.clipPlane`,
 * `Camera.hidden`, `Camera.showOnly`, `../../../../sdk-core/src/contracts/viewOptions.ts`): its
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
  const { hidden, showOnly } = cam.viewSet
  writeViewClipPlaneAtEye(rt, cam, uniforms.clipPlane, 0)
  const before = uniforms.filter
  let filter = filters.get(uniforms)
  if (!filtering || (!filter && hidden.length === 0 && showOnly === null)) {
    uniforms.filter = undefined
    if (before) staleCasters(rt, before, undefined)
    return
  }
  if (!filter) filters.set(uniforms, (filter = createViewFilter()))
  const { layout, run } = rt
  uniforms.filter = filter.update(
    cam.viewSet,
    layout.selectionRoots.length,
    (node, out, at) => appendRootsUnder(layout, node, out, at),
    run.gate.revisions.scene,
  )
  if (uniforms.filter !== before) staleCasters(rt, before, uniforms.filter)
}

/**
 * The placements whose bit differs between two filters' bits — one the view has and the other has
 * not, or a filter that came or went — cast otherwise into the view's shadows from now on: their
 * rows are derived again and their shadow pages staled, as for a placement shown or hidden
 * (`../../placement/webgpuPlacements.ts`, `flipWorld`).
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
      deriveRootRows(rt, rank)
      differ &= differ - 1
    }
  }
}
