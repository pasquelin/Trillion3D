/**
 * THE WORLD OBJECT A PLACED ROW DRAWS.
 *
 * The world DAG names its objects by their rank among the table's objects, cell after cell
 * (`world-roots.table`): per cell, its placed nodes in the cell's order, and per node the primitives
 * of its mesh the cook continued, in manifest order. A partition places a cell's node `j` on a row
 * of each primitive of its mesh (`../partition/placements.ts`): that row draws the object of the
 * cell's run of node `j`, whose primitive is the row's. The runs are read off the cell's objects —
 * consecutive objects of one published node —, each matched to the next node of the cell whose mesh
 * it places: a node whose mesh the cook continued nothing of has no run.
 */
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'

/** Per node of a cell whose nodes place meshes `meshes`, its first object among the cell's
 *  `objects`, -1 for a node without one. */
function nodeRuns(
  objects: ReturnType<WorldRoots['cells']['objects']>,
  meshes: Int32Array,
  primitives: readonly Primitive[],
) {
  const first = new Int32Array(meshes.length).fill(-1)
  let r = 0
  for (let node = 0; node < meshes.length && r < objects.length; node++) {
    if (primitives[objects[r].primitive]?.mesh !== meshes[node]) continue
    first[node] = r
    const id = objects[r].node
    while (r < objects.length && objects[r].node === id) r++
  }
  return first
}

/** The objects of `table` as rows draw them, its primitives read from `primitives`. */
export function createWorldObjects(table: WorldRoots, primitives: readonly Primitive[]) {
  type Cell = {
    meshes: Int32Array
    first: number
    objects: ReturnType<typeof table.cells.objects>
  }
  const cells = new Map<number, Cell & { runs: Int32Array }>()
  return {
    /**
     * The object the row of node `node` of `cell` draws for primitive `primitive` of mesh `mesh`,
     * the cell's nodes placing `meshes` (`CellRows`); -1 when the cook continued none.
     */
    objectOf(cell: number, node: number, meshes: Int32Array, mesh: number, primitive: number) {
      let own = cells.get(cell)
      if (!own || own.meshes !== meshes) {
        const objects = cell < table.cells.count ? table.cells.objects(cell) : []
        own = {
          meshes,
          first: cell < table.cells.count ? table.cells.first(cell) : 0,
          objects,
          runs: nodeRuns(objects, meshes, primitives),
        }
        cells.set(cell, own)
      }
      const { objects, runs, first } = own,
        start = runs[node]
      for (
        let k = start;
        k >= 0 && k < objects.length && objects[k].node === objects[start].node;
        k++
      ) {
        const placed = primitives[objects[k].primitive]
        if (placed?.mesh === mesh && placed.primitive === primitive) return first + k
      }
      return -1
    },
    /** `cell` left: what was read of it is let go. */
    release: (cell: number) => void cells.delete(cell),
  }
}
