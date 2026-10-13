// A mesh cut at run time is clustered and culled by the compiler's builders (`runtimeCut.ts`, in the
// page worker): the GPU descent tests the pages a view reaches, never all N. On a generated grid
// whose index buffer runs by COLUMNS — the order in which consecutive runs make pages and boxes as
// long as the mesh — the same close view over the grid and over the grid four times as large tests
// the same candidates, a small share of the pages: the law is O(visible), not O(N).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import '../../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'
import { cutDrawnTriangles } from '../../../packages/sdk-browser/src/world/page/runtimeCut.ts'
import { cullingNodes } from '../../../packages/sdk-browser/src/page/selection/helpers.ts'
import type { DagRoot } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { runSelectionKernel } from './selectionKernel.ts'
import { type SelectionCase } from './selectionCase.ts'
import { posedSelection } from './selectionCase.ts'

const VIEWPORT: [number, number] = [1280, 720]

/** A `side` × `side` grid of unit quads in the z = 0 plane, its triangles listed column by column. */
function columnGrid(side: number) {
  const positions = new Float32Array((side + 1) * (side + 1) * 3)
  for (let y = 0; y <= side; y++)
    for (let x = 0; x <= side; x++) positions.set([x, y, 0], (y * (side + 1) + x) * 3)
  const indices = new Uint32Array(side * side * 6)
  let at = 0
  for (let x = 0; x < side; x++)
    for (let y = 0; y < side; y++) {
      const v = y * (side + 1) + x
      indices.set([v, v + 1, v + side + 2, v, v + side + 2, v + side + 1], at)
      at += 6
    }
  return { positions, normals: new Float32Array(0), uvs: null, colors: null, indices }
}

/** The grid cut at run time, as one root: its pages' boxes and the hierarchy the cut built, read
 *  through the engine's adapter (`cullingNodes`). */
async function cutRoot(side: number): Promise<DagRoot> {
  const cut = await cutDrawnTriangles(columnGrid(side), false, false)
  const pages = cut.pages.map((page, id) => ({
    url: `p${id}`,
    level: 0,
    triangles: page.count / 3,
    min: page.min,
    max: page.max,
    sphere: page.sphere,
    lodError: 0,
    parentError: null,
    parentSphere: null,
  }))
  const culling = cullingNodes(cut.culling, pages.length)
  assert.ok(culling, 'the cut carries its hierarchy')
  return { world: new G.Matrix4(), pages, culling } as unknown as DagRoot
}

test('a run-time cut tests the pages a view reaches, not all of them, whatever the mesh size', async () => {
  const camera = G.perspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 50)
  const cases: SelectionCase[] = []
  for (const side of [128, 256]) {
    const roots = [await cutRoot(side)]
    // A close view of a corner of the grid, the same for both sizes.
    const { packed, uniforms } = posedSelection(camera, [6, 4, 1], VIEWPORT, roots)
    cases.push({ name: `${side}²`, packed, uniforms })
  }
  const { readings } = await runSelectionKernel(cases)
  const rows = readings.map((r, k) => ({
    grid: cases[k].name,
    pages: cases[k].packed.pageCount,
    candidates: r.candidates,
    kept: r.pages.length,
  }))
  console.log(JSON.stringify({ rows }))
  const [small, large] = rows
  assert.ok(small.kept > 0 && small.kept === large.kept, 'the view keeps the same pages')
  assert.ok(large.pages >= 3.9 * small.pages, 'the large grid is four times the pages')
  assert.ok(large.candidates <= 1.25 * small.candidates, 'candidates follow the view, not N')
  assert.ok(large.candidates * 10 < large.pages, 'a tenth of the pages at most are tested')
})
