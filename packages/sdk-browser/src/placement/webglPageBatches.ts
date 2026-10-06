import type { Scene } from '../world/core/scene.ts'
import {
  hostPageInstances,
  releaseHostInstances,
  setHostInstance,
  setHostInstanceCount,
} from '../host/pageObjects.ts'
import type { HostInstancedMesh, HostMaterials } from '../host/resources.ts'
import type { PageRec } from '../page/selection/types.ts'
import type { PageDraws } from '../backend/autonomous/pageDraws.ts'
import { rootOf, type Placements } from '../page/selection/placements.ts'
import { grownCapacity } from './rows.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'

type Group = {
  mesh: HostInstancedMesh | null
  capacity: number
  count: number
  first: PageRec
}

/**
 * The pages the WebGL2 path draws at the rows of an instance buffer: one instanced mesh per
 * page geometry and surface, whatever number of placements show it, its matrices the rows'. A
 * frame counts what each mesh shows, remakes a mesh too small for it at twice its size at least
 * — its size follows what frames show, never a number picked here —, then writes one matrix per
 * shown record — its root's world, `roots` ranking them — and one count per mesh. A mesh whose
 * page no placement shows leaves the graph. A frame that shows the same records, on rows nobody
 * wrote since, writes nothing.
 */
export function createWebglPageBatches(scene: Scene, roots: Placements, draws: PageDraws) {
  const groups = new Map<Geometry, Map<HostMaterials, Group>>()
  const geometryOf = (rec: PageRec) => draws.drawing(rec).geometry
  const drop = (group: Group) => {
    if (!group.mesh) return
    scene.remove(group.mesh)
    releaseHostInstances(group.mesh)
    group.mesh = null
  }
  const groupOf = (rec: PageRec) => {
    const geometry = geometryOf(rec)!
    let bySurface = groups.get(geometry)
    if (!bySurface) groups.set(geometry, (bySurface = new Map()))
    let group = bySurface.get(rec.declaration)
    if (!group)
      bySurface.set(rec.declaration, (group = { mesh: null, capacity: 0, count: 0, first: rec }))
    return group
  }
  // What the last draw wrote: its records, with the geometry and surface each wore then. A frame
  // that shows the same, on rows nobody wrote since, leaves every matrix and count as it is.
  const drawn: PageRec[] = [],
    drawnPacked: number[] = [],
    drawnGeometry: (Geometry | undefined)[] = [],
    drawnSurface: HostMaterials[] = []
  let rowsWritten = true
  // The packed rank too: one record serves every row of its page (#1235), so the same records may
  // show other rows, whose matrices differ.
  const unchanged = (shown: readonly PageRec[], shownPacked: readonly number[]) => {
    if (rowsWritten || shown.length !== drawn.length) return false
    for (let i = 0; i < shown.length; i++) {
      const rec = shown[i]
      if (
        rec !== drawn[i] ||
        shownPacked[i] !== drawnPacked[i] ||
        geometryOf(rec) !== drawnGeometry[i] ||
        rec.declaration !== drawnSurface[i]
      )
        return false
    }
    return true
  }
  const remember = (shown: readonly PageRec[], shownPacked: readonly number[]) => {
    rowsWritten = false
    drawn.length = drawnPacked.length = drawnGeometry.length = drawnSurface.length = shown.length
    for (let i = 0; i < shown.length; i++) {
      drawn[i] = shown[i]
      drawnPacked[i] = shownPacked[i]
      drawnGeometry[i] = geometryOf(shown[i])
      drawnSurface[i] = shown[i].declaration
    }
  }
  return {
    /** Rows were written or rebound: the next draw writes its matrices again. */
    rowsWritten() {
      rowsWritten = true
    },
    /** Draws `shown` — records placed by rows, each with its geometry, and the packed rank of each
     *  instance (`shownPacked`, #1235) — this frame. */
    draw(shown: readonly PageRec[], shownPacked: readonly number[]) {
      if (unchanged(shown, shownPacked)) return
      const rootOfPacked = draws.placement.rootOfPacked
      for (const bySurface of groups.values())
        for (const group of bySurface.values()) group.count = 0
      for (const rec of shown) groupOf(rec).count++
      for (const [geometry, bySurface] of groups) {
        for (const [surface, group] of bySurface) {
          if (!group.count) {
            drop(group)
            bySurface.delete(surface)
          } else if (group.count > group.capacity) {
            drop(group)
            group.capacity = grownCapacity(group.capacity, group.count)
            const { first } = group
            group.mesh = hostPageInstances(geometry, surface, first.renderOrder, group.capacity)
            scene.add(group.mesh)
          }
          group.count = 0
        }
        if (!bySurface.size) groups.delete(geometry)
      }
      for (let i = 0; i < shown.length; i++) {
        const rec = shown[i],
          group = groupOf(rec)
        setHostInstance(
          group.mesh!,
          group.count++,
          rootOf(roots, rootOfPacked[shownPacked[i]]).world,
        )
      }
      for (const bySurface of groups.values())
        for (const group of bySurface.values()) setHostInstanceCount(group.mesh!, group.count)
      remember(shown, shownPacked)
    },
    /** Takes every instanced page off the display graph. */
    clear() {
      for (const bySurface of groups.values()) for (const group of bySurface.values()) drop(group)
      groups.clear()
      rowsWritten = true
    },
  }
}
