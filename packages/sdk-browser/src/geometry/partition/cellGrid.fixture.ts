// A square world of cells of 10 m, as the cook halves and writes it, for the partition's tests
// (`cellIndex.test.ts`, `cellCatalogue.test.ts`).
import type { CellRecord } from './paged.fixture.ts'

/** A square world of `side` × `side` cells of 10 m on the ground — x and z, glTF's `+Y` up —, under
 *  the core node `rank` or the root, in the order the cook halves them (`split.rs`): its records
 *  and its cell files. */
export function grid(side: number, rank: number | null = null) {
  const cells: CellRecord[] = []
  const files = new Map<string, Uint8Array>()
  const halve = (x: number, y: number, width: number, height: number) => {
    if (width * height > 1) {
      if (width >= height) [x, x + width / 2].forEach((at) => halve(at, y, width / 2, height))
      else [y, y + height / 2].forEach((at) => halve(x, at, width, height / 2))
      return
    }
    const url = `cell-${x}-${y}.json`
    const box = [10 * x, 0, 10 * y, 10 * x + 10, 1, 10 * y + 10]
    cells.push({
      url,
      sha256: '',
      bytes: 1,
      parents: [[rank, box]],
      meshes: [[0, 1]],
      meshPages: [],
    })
    const node = { parent: rank, mesh: 0, matrix: null, rotation: null, scale: null }
    const body = { version: 3, nodes: [{ ...node, translation: [10 * x + 5, 0, 10 * y + 5] }] }
    files.set(url, new TextEncoder().encode(JSON.stringify(body)))
  }
  halve(0, 0, side, side)
  return { cells, files }
}
