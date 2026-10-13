// The generated world the eviction proofs fly through: `copies` primitives of the cut-rule DAG in a
// row along +x — each its own content, its own pages —, the strip camera looking down the row, and
// the frame's view of it at any x. Nothing names a bench scene: a DAG of groups and the groups
// replacing them, placed many times, as a world of them is.
import { ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts'
import {
  placements,
  stripCamera,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { writeEngineCamera } from '../../../packages/sdk-browser/src/camera/engineCamera.ts'
import { postPackedBases } from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts'
import type { GpuSelection } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'

/** A world of `copies` DAGs of `leaves` leaves, `gap` units apart, each a primitive of its own. */
export function evictionWorld(copies: number, leaves = 64, gap = 8) {
  const dag = ruleDag(leaves),
    spacing = leaves + gap
  // Placed along +x; each copy its own culling nodes, so its own records and its own content keys.
  const roots = placements(dag, copies, -spacing).map((root) => ({
    ...root,
    culling: { ...root.culling!, nodes: Float64Array.from(root.culling!.nodes) },
  })) as unknown as Parameters<typeof packDagSelection>[0]
  const packed = packDagSelection(roots)
  const pages = roots.flatMap((root) => root.pages) as unknown as PageRec[]
  const placement = postPackedBases(roots as never)
  /** The camera at `x` down the row, its worlds brought to its render frame and sent to
   *  `selection`: the uniforms it cuts under. */
  const view = (x: number, selection?: GpuSelection) => {
    const cam = stripCamera(dag)
    cam.world[12] += x
    writeEngineCamera(cam, { fov: 70, aspect: 16 / 9, near: 0.1, far: 4000, zoom: 1 })
    packedWorldsToRenderOrigin(packed, roots, cam.eye)
    selection?.updateWorlds(packed.worlds)
    return cameraSelectionUniforms(cam, 1, [1280, 720])
  }
  /** Each packed page's leaf units, by copy: what a cut covers (`coverFault`). */
  const units = pages.map((rec) => (rec as unknown as { units: [number, number] }).units)
  const copyOf = (page: number) => Math.floor(page / dag.pages.length)
  return { dag, roots, packed, pages, placement, view, units, copyOf, spacing }
}
