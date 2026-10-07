// The world DAG the cook publishes (`worldDag`) packed in the one cut after one placement per
// object, a unit-wide cluster at its unit placing it, seen by the strip camera: the scene the
// world gate's and the lone objects' proofs cut.
import { worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { packDagSelection } from './pack.ts'
import { stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { flatHierarchy } from './hierarchy.ts'
import { structureIndex } from '../../page/selection/structure.ts'
import type { DagRoot } from './types.ts'

/** The world with `alone` lone objects past its cells (`worldDag`), then one placement per object:
 *  the roots, their packing, the camera, and the world DAG's first packed page. */
export function worldScene(alone = 0) {
  const world = worldDag(alone)
  const page = {
    url: '',
    level: 0,
    lodError: 0,
    sphere: [0.5, 0, 0, 0.5],
    parentError: null,
    parentSphere: null,
    min: [0, -0.25, -0.25],
    max: [1, 0.25, 0.25],
    triangles: 2,
  }
  const placements: DagRoot[] = Array.from({ length: world.leaves }, (_, u) => {
    const pages = [{ ...page, url: `object${u}` }]
    const elements = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, u, 0, 0, 1)
    const structure = structureIndex({ version: 1, roots: [0], groups: [] }, 1)
    return { world: { elements }, pages, culling: flatHierarchy(pages), structure }
  })
  const roots = [...placements, world as unknown as DagRoot]
  const packed = packDagSelection(roots)
  // Placement `u` places object `u`, as the cut is told it (`placeObject`): its link, in the cold
  // table where the kernel reads it.
  const placed = packed.world!,
    cold = new Uint32Array(packed.pageCones.buffer)
  for (let u = 0; u < world.leaves; u++)
    cold[placed.linkBase + u] = placed.links[u] = placed.linkOf(u)
  const cam = stripCamera(world)
  packedWorldsToRenderOrigin(packed, roots, cam.eye)
  return { world, roots, packed, cam, base: packed.cutLinks[world.leaves].pageBase }
}

export type WorldScene = ReturnType<typeof worldScene>

/** Per object of `s`, how many of the `drawn` pages cover it: a placement its own, a super-root
 *  its units. */
export function objectCovers(s: WorldScene, drawn: readonly number[]) {
  const count = new Array<number>(s.world.leaves).fill(0)
  for (const page of drawn) {
    if (page < s.base) count[page]++
    else if (s.world.pages[page - s.base].level > 0) {
      const [a, b] = s.world.pages[page - s.base].units
      for (let u = a; u < b; u++) count[u]++
    }
  }
  return count
}
