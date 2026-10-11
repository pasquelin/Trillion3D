import test from 'node:test'
import assert from 'node:assert/strict'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import {
  DAG_CLUSTER_TRIANGLES,
  DAG_CLUSTER_VERTICES,
} from '../../../../sdk-core/src/page/format.ts'
import '../../wasm/sdkWasm.fixture.ts'
import { cutDrawnTriangles } from './runtimeCut.ts'

// The compiler's cluster size (`dag.rs`, printed into `sdk-core/src/page/format.ts`) is the run-time
// cutter's: a page it writes holds at most that many triangles and vertices, and a dense mesh
// fills them.

test("the run-time cutter's clusters are the compiler's size", async () => {
  const drawn = drawnTriangles(geometry.sphere(1, 64, 32), 'triangles')!
  const { pages } = await cutDrawnTriangles(drawn, false, false)
  assert.ok(pages.length > 2, 'the sphere spans several clusters')
  for (const page of pages) {
    assert.ok(page.indexCount / 3 <= DAG_CLUSTER_TRIANGLES, `${page.indexCount / 3} triangles`)
    assert.ok(page.vertexCount <= DAG_CLUSTER_VERTICES, `${page.vertexCount} vertices`)
  }
  assert.ok(pages.some((page) => page.indexCount / 3 === DAG_CLUSTER_TRIANGLES))
})
