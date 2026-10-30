// The screen probes' integration of the overflow tiles (`LumenScreenProbeGather.cpp:1533-1570, 1620-1680`): the classification and the integration of the
// closures past the first run over the tiles the closure tiles list for the closure, not over the view; a view of one closure keeps its kernels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { assertProgramAssembles, unbalanced } from '../../gpu/core/wgslNames.fixture.ts'
import { integrateShader, tileShader, TILE_OVERFLOW_BINDINGS } from './screen/integratePassWgsl.ts'
import { kernelShapeOf, screenProbeSources, shapeKey } from './screen/kernels.ts'
import { OCCLUSION_OVERFLOW_BINDING, occlusionShader } from './screen/occlusionWgsl.ts'
import {
  OCCLUSION_TRIANGLES_OVERFLOW_BINDING,
  occlusionTrianglesEntries,
  occlusionTrianglesProgram,
} from './screen/occlusionTrianglesWgsl.ts'

const settings = screenProbeSettings({ screenProbes: 'ultra' })

test('the overflow classification reads the tile of its workgroup from the closure tiles, lists it by the closure tile’s coordinates and clears no cell outside it', () => {
  for (const integrate of [1, 2]) {
    const code = tileShader(integrate, 0, [4, 4], true)
    assertProgramAssembles(code, 'tileClassify', `the overflow classification at ${integrate}`)
    assert.match(
      code,
      new RegExp(
        `@binding\\(${TILE_OVERFLOW_BINDINGS.at.overflow}\\) var<storage,read> overflowList`,
      ),
    )
    assert.match(code, /let entry=overflowTileAt\(group\);/)
    // The cells of the closure tile are the first threads of the workgroup, the side over the reduction along each way; an entry past the count is no cell.
    assert.match(code, /let cell=entry\.xy\*\(8u\/SP_INTEGRATE_DOWNSAMPLE\)\+local\.xy;/)
    assert.match(
      code,
      /let inside=entry\.z!=0u&&all\(local\.xy<vec2u\(8u\/SP_INTEGRATE_DOWNSAMPLE\)\)&&all\(cell<spIntegrateSize\(\)\);/,
    )
    assert.match(code, /tileList\[mode\*spTileCount\(\)\+place\]=entry\.x\|\(entry\.y<<16u\);/)
    // The lists hold a closure tile for each tile of the image, whatever the reduction.
    assert.match(
      code,
      /fn spTileCount\(\)->u32\{return \(\(sp\.size\.x\+7u\)\/8u\)\*\(\(sp\.size\.y\+7u\)\/8u\);\}/,
    )
  }
})

test("the first closure's classification and integration texts are the view's: the overflow ones are other programs", () => {
  const plain = tileShader(2, 0, [4, 4])
  assert.equal(plain, tileShader(2, 0, [4, 4], false))
  assert.doesNotMatch(plain, /overflow/i)
  assert.match(plain, /let cell=group\.xy\*8u\+local\.xy;/)
  const integrate = integrateShader(1, 2, 0, [4, 4], false, false, 1, true)
  assert.equal(integrate, integrateShader(1, 2, 0, [4, 4], false, false, 1, true, false))
  assert.doesNotMatch(integrate, /overflow/i)
  const flowing = integrateShader(1, 2, 0, [4, 4], false, false, 1, true, true)
  assertProgramAssembles(flowing, 'integrateSimple', 'the overflow integration')
  assert.match(flowing, /if\(any\(local>=vec2u\(8u\/SP_INTEGRATE_DOWNSAMPLE\)\)\)\{return;\}/)
  assert.match(flowing, /vec2u\(tile&0xffffu,tile>>16u\)\*\(8u\/SP_INTEGRATE_DOWNSAMPLE\)\+local/)
  // Where the tiles are not classified there is nothing to list: every cell is integrated for every closure (`LumenScreenProbeGather.cpp:1688-1740`).
  assert.doesNotMatch(
    integrateShader(1, 1, 0, [4, 4], false, false, 1, false, true),
    /overflowTileAt/,
  )
})

test('a view of several closures asks the overflow kernels where its tiles are classified, and a view of one asks none', () => {
  const classified = kernelShapeOf(settings)
  assert.equal(classified.classified, true)
  const names = (overflow: boolean) =>
    Object.keys(
      screenProbeSources(
        { ...classified, overflow },
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      ),
    )
  assert.ok(!names(false).some((name) => name.endsWith('Overflow')))
  assert.deepEqual(
    names(true).filter((name) => name.endsWith('Overflow')),
    ['tileOverflow', 'integrateOverflow', 'occlusionOverflow'],
  )
  // The other kernels are the same sources: the shapes differ in the key alone.
  const base = screenProbeSources(classified, undefined, undefined, undefined, undefined, false)
  const flowing = screenProbeSources(
    { ...classified, overflow: true },
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  )
  for (const [name, source] of Object.entries(base))
    assert.deepEqual(flowing[name as keyof typeof flowing], source, name)
  assert.notEqual(shapeKey(classified), shapeKey({ ...classified, overflow: true }))
  const overflow = flowing as unknown as Record<
    string,
    { entries: GPUBindGroupLayoutEntry[]; points: string[] }
  >
  assert.deepEqual(overflow.tileOverflow!.points, ['tileInit', 'tileClassify', 'tileFinish'])
  assert.ok(
    overflow.tileOverflow!.entries.some(
      (entry) => entry.binding === TILE_OVERFLOW_BINDINGS.at.overflow,
    ),
  )
  assert.ok(
    !base.tile!.entries.some((entry) => entry.binding === TILE_OVERFLOW_BINDINGS.at.overflow),
  )
  // Without the classification there are no tile lists to classify or integrate: every cell is integrated for every closure; the occlusion still runs over the overflow tiles.
  const every = kernelShapeOf(
    screenProbeSettings({ screenProbes: 'ultra', screenProbeIntegrationTileClassification: false }),
  )
  assert.equal(every.classified, false)
  assert.deepEqual(
    Object.keys(
      screenProbeSources(
        { ...every, overflow: true },
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      ),
    ).filter((name) => name.endsWith('Overflow')),
    ['occlusionOverflow'],
  )
})

test('the occlusion over the overflow tiles reads its tile like the classification, the texels of a closure tile being the first threads of the workgroup', () => {
  for (const downsample of [1, 2]) {
    const shape = { ...kernelShapeOf(settings).occlusion, downsample }
    const code = occlusionShader(shape, [4, 4], true)
    assertProgramAssembles(
      code,
      'occlusion',
      `the occlusion over the overflow tiles at ${downsample}`,
    )
    assert.match(code, /let entry=overflowTileAt\(group\);/)
    assert.match(code, /let id=vec3u\(entry\.xy\*\(8u\/SP_OCCLUSION_DOWNSAMPLE\)\+local\.xy,0u\);/)
    assert.match(
      code,
      new RegExp(`@binding\\(${OCCLUSION_OVERFLOW_BINDING}\\) var<storage,read> overflowList`),
    )
    // The pass over the view is the one it was.
    const plain = occlusionShader(shape, [4, 4])
    assert.equal(plain, occlusionShader(shape, [4, 4], false))
    assert.match(plain, /fn occlusion\(@builtin\(global_invocation_id\) id:vec3u\)\{/)
    assert.doesNotMatch(plain, /overflow/i)
  }
  const triangles = occlusionTrianglesProgram(
    kernelShapeOf(settings).occlusion,
    [4, 4],
    4,
    0.001,
    undefined,
    true,
  )
  assert.equal(unbalanced(triangles), '')
  assert.match(triangles, /let entry=overflowTileAt\(group\);/)
  assert.doesNotMatch(
    occlusionTrianglesProgram(kernelShapeOf(settings).occlusion, [4, 4], 4, 0.001),
    /overflow/i,
  )
  assert.ok(
    occlusionTrianglesEntries(false, true).some(
      (entry) => entry.binding === OCCLUSION_TRIANGLES_OVERFLOW_BINDING,
    ),
  )
  assert.ok(
    !occlusionTrianglesEntries(false).some(
      (entry) => entry.binding === OCCLUSION_TRIANGLES_OVERFLOW_BINDING,
    ),
  )
})
