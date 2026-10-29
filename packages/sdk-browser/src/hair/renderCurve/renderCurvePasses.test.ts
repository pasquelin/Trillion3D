// The curve raster's clusters, shared block and passes, read from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import type { HairStrandsGroup } from '../../../../sdk-core/src/hair/hairStrandsFile.ts'
import { toHalf } from '../../../../math/src/float/half.ts'
import { RENDER_CURVE_BINNING_WGSL } from './binningWgsl.ts'
import { buildRenderCurveClusters, renderCurvePointsPerCurve } from './clusterBuild.ts'
import { RENDER_CURVE_COMPACTION_WGSL } from './compactionWgsl.ts'
import { RENDER_CURVE_CLUSTER_CULL_WGSL, RENDER_CURVE_INSTANCE_CULL_WGSL } from './cullWgsl.ts'
import { RENDER_CURVE_HZB_WGSL, renderCurveHzbWords } from './hzbWgsl.ts'
import { RENDER_CURVE_INDIRECT_ARGS_WGSL } from './indirectArgsWgsl.ts'
import { RENDER_CURVE_PARAMS_BYTES } from './paramsWgsl.ts'
import { renderCurveCommon, renderCurveClusterStride } from './renderCurveMath.ts'
import { writeRenderCurveParams } from './renderCurveParams.ts'

/** A group of two strands, of 5 and 20 points, along x. */
function group(): HairStrandsGroup {
  const counts = [5, 20]
  const curves = new Uint32Array(2)
  let first = 0
  counts.forEach((n, i) => {
    curves[i] = first | (n << 24)
    first += n
  })
  const points = new Uint8Array(first * 8)
  const view = new DataView(points.buffer)
  for (let p = 0; p < first; p++) {
    view.setUint16(p * 8, toHalf(p * 0.01), true)
    view.setUint16(p * 8 + 2, toHalf(0.5), true)
    view.setUint16(p * 8 + 4, toHalf(0.25), true)
    points[p * 8 + 6] = p
    points[p * 8 + 7] = 63
  }
  return {
    curveCount: 2,
    pointCount: first,
    maxLength: 1,
    maxRadius: 0.01,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
    curves: new Uint8Array(curves.buffer),
    points,
  } as unknown as HairStrandsGroup
}

test('a strand of any length is cut into curves of at most the points a cluster allows, sharing their joints', () => {
  const g = group()
  assert.equal(renderCurvePointsPerCurve([g]), 16)
  const { data, clusterCount } = buildRenderCurveClusters(g, 16)
  assert.equal(clusterCount, 1)
  assert.equal(data.byteLength, renderCurveClusterStride(16))
  const view = new DataView(data.buffer)
  // 64 curves a cluster, 16 points a curve, three curves (5 points, then 16 and 5).
  assert.equal(view.getUint32(12, true), 64 | (16 << 8) | (3 << 16))
  const valid = (curve: number, point: number) =>
    (view.getUint32(32 + (64 * point + curve) * 8 + 4, true) >>> 30) & 1
  const lengths = [0, 1, 2].map((curve) => {
    let n = 0
    while (n < 16 && valid(curve, n)) n++
    return n
  })
  assert.deepEqual(
    lengths.sort((a, b) => a - b),
    [5, 5, 16],
  )
  assert.equal(valid(3, 0), 0)
})

test('the blocks and passes name nothing they do not declare', () => {
  for (const code of [
    RENDER_CURVE_HZB_WGSL,
    RENDER_CURVE_INSTANCE_CULL_WGSL,
    RENDER_CURVE_CLUSTER_CULL_WGSL,
    RENDER_CURVE_INDIRECT_ARGS_WGSL,
    RENDER_CURVE_BINNING_WGSL,
    RENDER_CURVE_COMPACTION_WGSL,
  ])
    assert.deepEqual(unresolvedNames(code), [])
})

test('the passes keep the reference steps: the count held to its room, the entries refused, the tile full at 1024', () => {
  assert.match(
    RENDER_CURVE_INDIRECT_ARGS_WGSL,
    /min\(atomicLoad\(&counters\[3\]\),curve\.maxVisibleClusters\)/,
  )
  assert.match(RENDER_CURVE_BINNING_WGSL, /let fits=entry<curve\.maxTileAllocCount;/)
  assert.match(RENDER_CURVE_BINNING_WGSL, /select\(filled,1024u,filled==0u\)/)
  assert.match(RENDER_CURVE_COMPACTION_WGSL, /primOffset\+total>curve\.maxZBinSegmentDataCount/)
  assert.match(RENDER_CURVE_COMPACTION_WGSL, /base\+bins<=curve\.maxZBinDataCount/)
})

test('the entries that can be given out are held to the segments room and to a tile info', () => {
  assert.equal(renderCurveCommon(7680, 4320, 32, 256, 0.05, 1 << 30).maxTileAllocCount, 0xffff)
  assert.equal(renderCurveCommon(1920, 1080, 32, 256, 0.05, 1 << 30).maxTileAllocCount, 8160)
  assert.equal(renderCurveCommon(1920, 1080, 32, 256, 0.05, 5000).maxTileAllocCount, 4)
})

test('the shared block holds the depth line of a perspective projection and the pyramid levels', () => {
  const words = wordViews(new ArrayBuffer(RENDER_CURVE_PARAMS_BYTES))
  const projection = new Float32Array(16)
  projection[10] = 0
  projection[11] = -1
  projection[14] = 0.1
  const common = renderCurveCommon(1920, 1080, 32, 256, 0.05, 1 << 30)
  writeRenderCurveParams(
    words,
    common,
    { viewProjection: new Float32Array(16), projection, perspective: true, eye: [0, 0, 0] },
    { instanceCount: 3, clusterCount: 7, strideWords: 10, maxVisible: 99 },
  )
  assert.equal(words.f[20], -0)
  assert.equal(words.f[21], Math.fround(0.1))
  assert.deepEqual([...words.u.subarray(16, 20)], [1920, 1080, 60, 34])
  assert.equal(words.u[33], 11)
  assert.equal(renderCurveHzbWords(4, 4), 4 + 1)
})
