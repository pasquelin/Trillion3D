// A draw that holds no cutout row (`FLAG_MASK`) draws with `vis_opaque_fs` or
// `vis_hiz_opaque_fs`, which neither read the page nor discard: on Apple's tile GPUs, a fragment
// stage that discards makes the hidden-surface removal flush and shade every layer it covers. The
// shipped stages run in `shaderRun` over the quantized pages of `pointHeader.fixture.ts`, far from
// the origin — every row kind, plus a double-sided opaque copy of each cutout row on its very
// triangles, so equal depths meet across slots and, between rows of one geometry, within a slot. A
// model raster draws the slots in their order and their rows in theirs, depth `greater` and written
// (`VIS_DEPTH`): with the cut stage on every slot, then with the opaque stage on each slot that
// holds no cutout row, the identifiers and depths are the same bits, and every fragment of a
// non-cutout row gets the same words from both stages before its depth test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat } from '../../texture/shaderRun.fixture.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { type Fn } from './triangleScene.fixture.ts'
import { matrixWindingCw } from '../../../../sdk-core/src/index.ts'
import { signedArea } from '../projection.ts'
import { VIS_SHADER } from './visWgsl.ts'
import * as F from '../types.ts'
import { cameraViewProj, pages, stages, VIS_VS_NAMES, VIS_VS_SCOPE } from './pointHeader.fixture.ts'

test('the opaque stages are the cut ones without their page read and their discard', () => {
  const bare = (name: string) => functionsOf(VIS_SHADER, [name]).replace(/\s+/g, '')
  const cut = 'letgx=dpdx(in.tc.xy);letgy=dpdy(in.tc.xy);'
  const keep = 'if(!maskKeep(pages[in.instance],in.tc.xy,in.tc.z,gx,gy)){discard;}'
  for (const [stage, opaque] of [
    ['vis_fs', 'vis_opaque_fs'],
    ['vis_hiz_fs', 'vis_hiz_opaque_fs'],
  ]) {
    const kept = bare(stage)
      .replace(cut + keep, '')
      .replace(`fn${stage}(`, `fn${opaque}(`)
    assert.equal(kept, bare(opaque), stage)
    assert.ok(!bare(opaque).includes('pages[') && !bare(opaque).includes('discard'), opaque)
  }
})

/** A discard, made a return the model sees: the only edit of the shipped text. */
const DISCARD = { discarded: true }
const CODE = VIS_SHADER.replaceAll('discard;', 'return DISCARD;')
type Row = Record<string, unknown> & { flags: number; indexCount: number; world: Mat }
/** Pages of up to twelve triangles, each cutout row followed by its opaque double-sided copy. */
const table: Row[] = (pages as Row[])
  .filter((page) => page.indexCount <= 36)
  .flatMap((page) =>
    page.flags & F.FLAG_MASK
      ? [page, { ...page, flags: (page.flags & ~F.FLAG_MASK) | F.FLAG_DOUBLE, lineWidth: 0 }]
      : [page],
  )
  .map((page, row) => ({
    ...page,
    ...{ packedBase: row << 8, baseColor: [1, 1, 1, 0.5], blendCoverage: 1, dash: [0, 0] },
    mapIndex: 0,
  }))
/** The row's slot of layer 0: back, none or front culled, as `visBin` ranks them. */
const binOf = (row: Row) =>
  row.flags & F.FLAG_DOUBLE
    ? 1
    : !!(row.flags & F.FLAG_BACK) !== matrixWindingCw(row.world.m)
      ? 2
      : 0

const uni = { viewProj: cameraViewProj(1), viewport: [1280, 720] }
Object.assign(uni, { pixelRatio: 1, computeSpan: 0, indirect: 0, drawSlot: 0 })
const run = stages(
  CODE,
  VIS_VS_NAMES.concat(
    ['lineDash', 'maskKeep', 'vis_fs', 'vis_hiz_fs', 'vis_opaque_fs'],
    ['vis_hiz_opaque_fs'],
  ),
  {
    ...{ uni, instances: [], slotOffsets: [0], pages: table, DISCARD, ...VIS_VS_SCOPE },
    ...{ dpdx: () => [0, 0], dpdy: () => [0, 0] },
    // A checker of alpha 0 and 1 over the UV: half of a mapped cutout row's pixels are cut.
    maskAlpha: (_map: number, uv: number[]) => (Math.floor(uv[0] * 6) + Math.floor(uv[1] * 6)) % 2,
  },
)
type Corner = { position: number[]; id: number; instance: number; tc: number[] }
const corners = table.map((row, at) =>
  Array.from({ length: row.indexCount }, (_, v) => run.vis_vs(v, at) as Corner),
)

const [W, H] = [96, 54]
/** The image of every slot, each drawn with the cut stage or, `opaqueSlots`, with the opaque one
 *  when it holds no cutout row. */
function raster(hiz: boolean, opaqueSlots: boolean) {
  const ids = new Uint32Array(W * H),
    depth = new Float32Array(W * H),
    hizDepth = new Float32Array(W * H)
  const seen = { ties: 0, discards: 0, opaque: 0, written: 0 }
  const [cutFs, opaqueFs] = hiz ? ['vis_hiz_fs', 'vis_hiz_opaque_fs'] : ['vis_fs', 'vis_opaque_fs']
  for (const bin of [0, 1, 2]) {
    const rows = table.flatMap((row, at) => (binOf(row) === bin ? [at] : []))
    const opaque = opaqueSlots && rows.every((at) => !(table[at].flags & F.FLAG_MASK))
    for (const at of rows)
      for (let t = 0; t * 3 < table[at].indexCount; t++) {
        const v = corners[at].slice(t * 3, t * 3 + 3)
        if (v.some(({ position: [, , z, w] }) => !(w > 0) || z < 0 || z > w)) continue
        const ndc = v.map(({ position: [x, y, z, w] }) => ({ x: x / w, y: y / w, z: z / w, w }))
        const area = signedArea(ndc[0], ndc[1], ndc[2])
        if (!area || (bin === 0 && area < 0) || (bin === 2 && area > 0)) continue
        for (let j = 0; j < H; j++)
          for (let i = 0; i < W; i++) {
            const p = { x: ((i + 0.5) / W) * 2 - 1, y: 1 - ((j + 0.5) / H) * 2 }
            const b = [
              signedArea(ndc[1], ndc[2], p),
              signedArea(ndc[2], ndc[0], p),
              signedArea(ndc[0], ndc[1], p),
            ]
            const w = b.map((e) => e / area)
            if (w.some((x) => x < 0)) continue
            const z = Math.fround(w[0] * ndc[0].z + w[1] * ndc[1].z + w[2] * ndc[2].z)
            const q = w.map((x, k) => x / ndc[k].w),
              sum = q[0] + q[1] + q[2]
            const tc = [0, 1, 2].map((c) =>
              Math.fround((q[0] * v[0].tc[c] + q[1] * v[1].tc[c] + q[2] * v[2].tc[c]) / sum),
            )
            const input = { ...v[0], position: [i + 0.5, j + 0.5, z, 1], tc }
            const out = (run[opaque ? opaqueFs : cutFs] as Fn)(input)
            if (opaque) {
              assert.deepStrictEqual(out, (run[cutFs] as Fn)(input), `row ${at}`)
              seen.opaque++
            }
            if (out === DISCARD) {
              seen.discards++
              continue
            }
            const pixel = j * W + i
            if (z === depth[pixel]) seen.ties++
            if (!(z > depth[pixel])) continue
            seen.written++
            depth[pixel] = z
            ids[pixel] = hiz ? (out as { id: number }).id : (out as number)
            if (hiz) hizDepth[pixel] = (out as { depth: number }).depth
          }
      }
  }
  return { image: { ids, depth, hizDepth }, seen }
}

for (const hiz of [false, true])
  test(`the opaque stage on slots without a cutout row draws the same image, hiz ${hiz}`, () => {
    const cut = raster(hiz, false),
      opaque = raster(hiz, true)
    assert.deepStrictEqual(opaque.image, cut.image)
    assert.deepStrictEqual(opaque.seen.written, cut.seen.written)
    assert.equal(cut.seen.opaque, 0)
    // The scene exercises what the proof is about: opaque slots, cutouts, ties, overdraw.
    assert.ok(opaque.seen.opaque > 1000, `${opaque.seen.opaque} opaque fragments`)
    assert.ok(cut.seen.discards > 100, `${cut.seen.discards} discards`)
    assert.ok(cut.seen.ties > 100, `${cut.seen.ties} ties`)
    assert.ok(cut.seen.written > 1000, `${cut.seen.written} writes`)
  })
