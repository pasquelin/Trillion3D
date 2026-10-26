import type { DagResources } from './resources.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { cutTablesAt } from './queueGrowth.ts'
import { writeDagUniforms } from './uniforms.ts'

/**
 * THE FILTER'S BITS IN `work` (`shader/viewFilterWgsl.ts`): the region behind the group counts
 * (`dagWorkLayout`, `filter`) holds one view's bits at a time — a bit a placement, set when the
 * view does not draw it (`../selection/viewFilter.ts`) —, written before the cut of a view that
 * filters, and only when the region does not hold them already: the array's identity is the
 * filter's revision, so a view cut again under the same filter sends nothing, and views that
 * alternate under their own send theirs when their cut runs. A view with none sends nothing and
 * names no region (`filterBase`, `writeDagUniforms`). Bits past the room the region has for the
 * placements the cut holds are not sent.
 */
export function writeViewFilter(
  {
    device,
    work,
    workLayout,
    filterHeld,
  }: Pick<DagResources, 'device' | 'work' | 'workLayout' | 'filterHeld'>,
  filter: Uint32Array | undefined,
) {
  if (!filter || filterHeld.bits === filter) return
  filterHeld.bits = filter
  const room = workLayout.words - workLayout.filter,
    words = Math.min(room, filter.length)
  if (words > 0)
    device.queue.writeBuffer(
      work,
      workLayout.filter * 4,
      filter.buffer,
      filter.byteOffset,
      words * 4,
    )
}

/** View `uniforms`' block put on the GPU for its cut: the uniforms written over the tables as they
 *  stand, then its filter's bits (`writeViewFilter`). The main view's cut and a view aside's alike. */
export function writeCutView(resources: DagResources, uniforms: SelectionUniforms) {
  const { device, uniformData, packed, listCap } = resources
  writeDagUniforms(uniformData, packed, uniforms, listCap, cutTablesAt(resources))
  device.queue.writeBuffer(resources.uniforms, 0, uniformData)
  writeViewFilter(resources, uniforms.filter)
}

/**
 * A view's filter held in `work` for a reader beside the cut — the sun's casters, which leave out
 * what the main view does not draw —: its bits written as for the view's cut (`writeViewFilter`),
 * the buffer and the word they start at returned. None for a view without a filter, or a cut whose
 * `work` holds no room for them.
 */
export function holdViewFilter(
  resources: Parameters<typeof writeViewFilter>[0],
  filter: Uint32Array | undefined,
) {
  const { work, workLayout } = resources
  if (!filter || workLayout.words <= workLayout.filter) return undefined
  writeViewFilter(resources, filter)
  return { buffer: work, base: workLayout.filter }
}
