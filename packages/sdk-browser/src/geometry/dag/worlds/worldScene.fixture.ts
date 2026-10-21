// The world DAG the cook publishes (`worldDag`) packed in the one cut after one placement per
// object, a unit-wide cluster at its unit placing it, seen by the strip camera: the scene the
// world gate's proofs cut.
import { worldDag } from '../../hlod/worldHlod.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { stripCamera } from '../../cut/cutRuleBackends.fixture.ts'
import { packedWorldsToRenderOrigin } from '../pack/pack.fixture.ts'
import { cullingInPlace } from '../culling.fixture.ts'
import { structureIndex } from '../../selection/structure.ts'
import type { DagRoot } from '../types.ts'
import { LINK_WORDS, setLink } from './worldLinks.ts'

/** The placing of a model `x` units along the strip. */
export const translated = (x: number) =>
  Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1)

/** One placement per object of a world of `leaves` objects per instance at `offsets` along the
 *  strip: object `u` of instance `k`, one unit-wide page at `offsets[k] + u`. */
export function objectPlacements(leaves: number, offsets: readonly number[] = [0]): DagRoot[] {
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
  return offsets.flatMap((offset, k) =>
    Array.from({ length: leaves }, (_, u) => {
      const pages = [{ ...page, url: `object${k}-${u}` }]
      const structure = structureIndex({ version: 1, roots: [0], groups: [] }, 1)
      return {
        world: { elements: translated(offset + u) },
        pages,
        culling: cullingInPlace(pages),
        structure,
      }
    }),
  )
}

/** One placement per object of the world (`worldDag`), then the world DAG: the roots, their
 *  packing, the camera, and the world DAG's first packed page. */
export function worldScene() {
  const world = worldDag()
  const roots = [...objectPlacements(world.leaves), world as unknown as DagRoot]
  const packed = packDagSelection(roots)
  // Placement `u` lies in HLOD 0 cell `u` of the world's one instance, as the cut is told it
  // (`placeInCell`): its link, in the cold table where the kernel reads it.
  const placed = packed.world!,
    cold = new Uint32Array(packed.coldWords.buffer)
  for (let u = 0; u < world.leaves; u++) setLink(placed, u, u, 0)
  cold.set(placed.links.subarray(0, world.leaves * LINK_WORDS), placed.linkBase)
  const cam = stripCamera(world)
  packedWorldsToRenderOrigin(packed, roots, cam.eye)
  return { world, roots, packed, cam, base: packed.cutLinks[world.leaves].pageBase }
}

export type WorldScene = ReturnType<typeof worldScene>

/** Per object of `s`, how much of it the `drawn` pages cover: a placement all of it, a world page
 *  the share of its unit its span along x holds. */
export function objectCovers(s: WorldScene, drawn: readonly number[]) {
  const count = new Array<number>(s.world.leaves).fill(0)
  for (const page of drawn) {
    if (page < s.base) count[page]++
    else {
      const { units, min, max } = s.world.pages[page - s.base]
      for (let u = units[0]; u < units[1]; u++)
        count[u] += Math.min(max[0], u + 1) - Math.max(min[0], u)
    }
  }
  return count
}
