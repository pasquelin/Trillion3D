import type { PageSurface } from './surface.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** What a frame asks of the resident clusters' surfaces: whether one of them, read in place,
 *  answers `true`. */
export type SurfaceQuestion = (surface: PageSurface) => boolean | undefined

/** An answer, with the list of surfaces and the age of the cluster records it was taken at. */
type Held = { surfaces: readonly PageSurface[]; epoch: number; answer: boolean }

/**
 * Whether a surface the resident clusters wear answers `question` (each read in place), one answer
 * held per cluster state: taken again only once the list of surfaces changed — one came or went
 * (`ResidentSurfaces.list`, `../clusters/surfaces.ts`) — or the records aged (`infoEpoch`): a
 * material's new values that change what its clusters read beside its record
 * (`materialTable.follow`, `../../frame/render/render.ts`), an alpha change
 * (`refreshWebgpuMaterials`) — else read where it was held. A frame over still clusters and
 * materials asks it in O(1), however many surfaces they wear.
 */
export function someRowSurface(question: SurfaceQuestion) {
  const held = new WeakMap<object, Held>()
  return (clusters: WebgpuPagesRuntime['layout']['clusters']) => {
    const surfaces = clusters.surfaces.list(),
      kept = held.get(clusters)
    if (kept && kept.surfaces === surfaces && kept.epoch === clusters.infoEpoch) return kept.answer
    const answer = surfaces.some((surface) => !!question(surface))
    held.set(clusters, { surfaces, epoch: clusters.infoEpoch, answer })
    return answer
  }
}
