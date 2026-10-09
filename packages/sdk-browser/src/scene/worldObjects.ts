/**
 * THE WORLD OBJECT A PLACED ROW DRAWS.
 *
 * The world DAG names its objects by their rank among the table's objects, cell after cell
 * (`world-roots.table`): per cell, its placed nodes in the cell's order, and per node the primitives
 * of its mesh the cook continued, in manifest order. A partition places a cell's node `j` on a row
 * of each primitive of its mesh (`../partition/placements.ts`): that row draws the object of node
 * `j` whose primitive is the row's. The cook writes each node's first object (`nodeObject`): one
 * read, then the node's run, a primitive of its mesh each.
 */
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'

/** The objects of `table` as rows draw them, its primitives read from `primitives`. */
export function createWorldObjects(table: WorldRoots, primitives: readonly Primitive[]) {
  return {
    /** The object the row of node `node` of `cell` draws for primitive `primitive` of mesh `mesh`;
     *  -1 when the cook continued none. */
    objectOf(cell: number, node: number, mesh: number, primitive: number) {
      if (cell >= table.cells.count) return -1
      const { cells } = table,
        start = cells.nodeObject(cell, node)
      if (start < 0) return -1
      // The node's run, read in place: its objects' words alone, no list built.
      const first = cells.first(cell),
        end = first + cells.size(cell),
        owner = cells.objectNode(first + start)
      for (let k = first + start; k < end && cells.objectNode(k) === owner; k++) {
        const placed = primitives[cells.objectPrimitive(k)]
        if (placed?.mesh === mesh && placed.primitive === primitive) return k
      }
      return -1
    },
  }
}
