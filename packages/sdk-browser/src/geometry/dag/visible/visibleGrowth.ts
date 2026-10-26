import { growCutBuffers } from '../lists/listGrowth.ts'
import { rebindCut } from '../recordsFollow.ts'
import { makeDagBuffer, pastBinding, visibleRow } from '../bufferTable.ts'
import type { DagResources } from '../resources.ts'
import type { DagRuntimeState } from '../runtime/runtimeState.ts'
import { visibleCapFor, visibleLimit } from './layout.ts'

/**
 * THE ROOM OF THE LIST OF VISIBLE CLUSTERS, followed (`layout.ts`): it starts at `INITIAL_VISIBLE`
 * records and follows what each readback says the cut asked of it — the clusters of both passes,
 * counted past the room (`PEAK_VISIBLE`) —, a quarter past it, within the packing's pages and the
 * setting that caps it (`cutMaxVisibleClusters`). It only grows: the room is a high-water mark, and
 * a view that once drew a great many clusters keeps the room it needed. The decoded records, the
 * bins and the rasters follow the same number (`GpuSelection.visibleCap`), made again at the
 * frame after the list. A cut past the room draws what fits and says nothing else — the setting's
 * own cap is the one that is told (`lists/listFeedback.ts`) —, and the next cut, on the room its
 * peak asked, draws it whole.
 */
export function askVisibleCap(resources: DagResources, state: DagRuntimeState, peak: number) {
  const { packed, listCaps } = resources
  const wanted = visibleCapFor(peak, visibleLimit(packed.live?.pages ?? packed.pageCount, listCaps))
  const refused = state.refusedVisible > 0 && wanted >= state.refusedVisible
  state.growVisible = wanted > resources.visibleCap && !refused ? wanted : 0
}

/**
 * Gives the camera cut a list of visible clusters of `cap` records, between two frames and with no
 * readback in flight: a new buffer made within the cut's share under an out-of-memory scope, the
 * bind groups that name it made again and the old buffer retired. A device that refuses keeps the
 * old list whole and says `false`. The list is written whole by every cut, so nothing is carried
 * over.
 */
export async function growVisible(resources: DagResources, cap: number, disposed: () => boolean) {
  if (pastBinding(resources.device.limits, { visible: visibleRow(cap) })) return false
  return growCutBuffers(resources, {
    replaced: [resources.visible],
    create: (make) => makeDagBuffer(make, visibleRow(cap)),
    adopt: (made) => {
      resources.visible = made
      resources.visibleCap = cap
      resources.group.visible = made
      rebindCut(resources)
    },
    disposed,
  })
}
