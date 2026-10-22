import test from 'node:test'
import { assertGolden } from '../../../../math/src/golden.fixture.ts'
import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'
import { cullingOfParts } from './cullingBuilder.ts'

// The culling hierarchy as the SDK module builds it for the run-time cut, against the nodes the
// compiler's native build writes (`page-codec-wasm/src/golden/culling.rs`): grids by rows and by
// columns, a soup, a strip, a stack of coincident boxes, none, a lone root, each a family of parts.
test('the module builds the hierarchy the compiler builds, bit for bit', () => {
  assertGolden('culling', 'build_culling_bvh', ([count, ...records]) => {
    const culling = cullingOfParts(sdkWasm, count, (view) => view.set(records))
    return [culling.count, ...culling.nodes]
  })
})
