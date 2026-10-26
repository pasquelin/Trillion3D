/**
 * THE SOURCE NODES THE PLACED CELLS OF A PARTITION DRAW, which the physics reads to make a body or
 * a collider with the cell that draws its node and let it go with it (`physics/modelBodies.ts`): a
 * node is drawn while a cell with a row for it is placed and draws its source meshes — a placed
 * cell whose main grid cell is no longer wished draws its HLOD 0 actor instead (`proxy`), and
 * draws no node as itself. `changes` counts every move of the set, so a reader looks again only
 * when it moved.
 */
export function createCellDraws() {
  /** The source node of every row of each placed cell. */
  const rows = new Map<number, Uint32Array>()
  /** The placed cells whose rows draw as their HLOD 0 actor. */
  const proxied = new Set<number>()
  /** How many placed cells draw each source node as themselves. */
  const counts = new Map<number, number>()
  let changes = 0
  /** Every node of `cell` drawn `by` once more (1) or once less (-1). */
  const count = (cell: number, by: 1 | -1) => {
    for (const node of rows.get(cell)!) {
      const drawn = (counts.get(node) ?? 0) + by
      if (drawn > 0) counts.set(node, drawn)
      else counts.delete(node)
    }
    changes++
  }
  return {
    /** How many times the set of nodes drawn changed. */
    get changes() {
      return changes
    },
    /** Whether a placed cell draws source node `node` as itself. */
    drawn: (node: number) => counts.has(node),
    /** Whether the rows of `cell` draw as its HLOD 0 actor. */
    proxied: (cell: number) => proxied.has(cell),
    /** `cell` placed, its rows drawing `sources`, a source node a row. */
    place(cell: number, sources: Uint32Array) {
      rows.set(cell, sources)
      count(cell, 1)
    },
    /** The rows of the placed `cell` draw as its HLOD 0 actor (`proxy`) or as itself. */
    proxy(cell: number, proxy: boolean) {
      if (proxied.has(cell) === proxy) return
      if (proxy) proxied.add(cell)
      else proxied.delete(cell)
      count(cell, proxy ? -1 : 1)
    },
    /** `cell` left. */
    leave(cell: number) {
      if (!proxied.delete(cell)) count(cell, -1)
      rows.delete(cell)
    },
  }
}
