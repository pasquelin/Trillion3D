/**
 * The materials this engine builds from a contract for a primitive, and therefore frees itself
 * (#840, #846, #847): one paint per repainted primitive, replaced — never stacked — by the next,
 * worn by the per-instance draw state (`pageDraws.ts`). Repainting n times keeps one.
 */
import type { HostMaterial } from '../../host/resources.ts'
import { colouredTwin, releaseHostSurface, setHostSurface } from '../../host/pageObjects.ts'
import { wearDeclaration } from '../../page/surface.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { PageDraws } from './pageDraws.ts'

export function createPaints(colorMaterials: Map<HostMaterial, HostMaterial>, draws: PageDraws) {
  const owned = new Map<string, HostMaterial>()
  /** Frees a paint and the twin the shared cache holds for it: repainting n times keeps one. */
  const release = (painted: HostMaterial) => {
    const twin = colorMaterials.get(painted)
    if (twin) {
      colorMaterials.delete(painted)
      releaseHostSurface(twin)
    }
    releaseHostSurface(painted)
  }
  const wear = (records: readonly PageRec[], painted: HostMaterial) => {
    // Records wear `painted`, or the vertex-coloured twin a page with a colour attribute draws
    // with, taken from the shared cache the decoded pages read (`painted` if it reads colours).
    for (const rec of records) {
      wearDeclaration(rec, rec.attributes.color ? colouredTwin(colorMaterials, painted) : painted)
      // Every instance wears it: one record serves all its primitive's placements (#1235).
      draws.forEachDraw(rec, (draw) => {
        draw.material = painted
        if (draw.mesh) setHostSurface(draw.mesh, rec.declaration)
      })
    }
  }
  return {
    wear,
    /** `primitive` now wears `painted`; the paint this one replaces is returned for `release`. */
    repaint(primitive: string, painted: HostMaterial) {
      const previous = owned.get(primitive)
      owned.set(primitive, painted)
      return previous
    },
    /** The paints this engine owns, by primitive: the caller frees those no record wears now. */
    entries: () => owned,
    forget: (primitive: string) => void owned.delete(primitive),
    release,
    dispose() {
      for (const painted of owned.values()) release(painted)
      owned.clear()
    },
  }
}
