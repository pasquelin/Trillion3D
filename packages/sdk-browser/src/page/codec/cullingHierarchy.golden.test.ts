import test from 'node:test'
import { assertGolden } from '../../../../math/src/golden.fixture.ts'
import { sdkWasm as module } from '../../wasm/sdkWasm.fixture.ts'
import { buildCullingHierarchy } from './cullingHierarchy.ts'

// The culling hierarchy as the SDK module builds it for the run-time cut, against the nodes and the
// order the compiler's native build writes (`page-codec-wasm/src/golden_tests/culling.rs`): grids
// by rows and by columns, a soup, a strip, a stack of coincident boxes, none, a lone root.
test('the module builds the hierarchy the compiler builds, bit for bit', () => {
  assertGolden('culling', 'build_culling_bvh', ([count, ...records]) => {
    const clusters = Array.from({ length: count }, (_, k) => {
      const r = records.slice(k * 12, k * 12 + 12)
      return {
        min: r.slice(0, 3),
        max: r.slice(3, 6),
        parentSphere: r.slice(6, 10),
        parentError: r[10] === Infinity ? null : r[10],
        level: r[11],
      }
    })
    const { order, culling } = buildCullingHierarchy(module, clusters)
    return [culling.count, ...culling.nodes, ...order]
  })
})
