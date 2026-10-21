// #831: a draw that holds no cutout row (`FLAG_MASK`) draws `vis_hiz_fs` with `MASKED` false, which
// neither reads the cutout's footprint nor its map. The shipped stages run in `shaderRun` over the
// quantized pages of `pointHeader.fixture.ts`, far from the origin — every row kind, plus a
// double-sided opaque copy of each cutout row on its very triangles, so equal depths meet across
// slots and, between rows of one geometry, within a slot. A model raster draws the slots in their
// order and their rows in theirs, each fragment taking the visibility write (`VIS_WRITE_WGSL`), its
// depth phase then its identifier phase: with the cut stage on every slot, then with the opaque
// stage on each slot that holds no cutout row, the visibility buffer holds the same bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import type { Fn } from './triangleScene.fixture.ts'
import { matrixWindingCw } from '../../../../math/src/matrix/orientation.ts'
import { signedArea } from '../../../../../bench/oracles/browser/cpu-image/projection.ts'
import { VIS_SHADER } from './visWgsl.ts'
import * as F from '../types.ts'
import { cameraViewProj, pages, stages, VIS_VS_NAMES, VIS_VS_SCOPE } from './pointHeader.fixture.ts'

test('the cutout footprint and test are the MASKED part of the stage alone', () => {
  const stage = functionsOf(VIS_SHADER, ['vis_hiz_fs']).replace(/\s+/g, '')
  const footprint = 'if(MASKED){gx=dpdx(in.tc.xy);gy=dpdy(in.tc.xy);}'
  const keep = 'if(MASKED&&!maskKeep(page,in.tc.xy,in.tc.z,gx,gy)){return;}'
  assert.ok(stage.includes(footprint) && stage.includes(keep))
  const unmasked = stage.replace(footprint, '').replace(keep, '')
  assert.ok(!unmasked.includes('dpdx') && !unmasked.includes('maskKeep'))
})

type Row = Record<string, unknown> & { flags: number; indexCount: number; world: Mat }
/** Pages of up to twelve triangles, each cutout row followed by its opaque double-sided copy. */
const table: Row[] = (pages as Row[])
  .filter((page) => page.indexCount <= 36)
  .flatMap((page) =>
    page.flags & F.FLAG_MASK
      ? [
          page,
          {
            ...page,
            flags: (page.flags & ~(F.FLAG_MASK | F.FLAG_LINE)) | F.FLAG_DOUBLE,
            material: { sprite: [0, 0], lineWidth: 0 },
          },
        ]
      : [page],
  )
  .map((page, row) => ({
    ...page,
    packedBase: row << 8,
    depthBias: 0,
    material: { ...(page.material as object), cut: 0.5, opacity: 1, dash: [0, 0], mapIndex: 0 },
  }))
/** The row's slot of layer 0: back, none or front culled, as `visBin` ranks them. */
const binOf = (row: Row) =>
  row.flags & F.FLAG_DOUBLE
    ? 1
    : !!(row.flags & F.FLAG_BACK) !== matrixWindingCw(row.world.m)
      ? 2
      : 0

const uni = { viewProj: cameraViewProj(1), viewport: [1280, 720] }
Object.assign(uni, { pixelRatio: 1, indirect: 0, drawSlot: 0 })
/** The visibility buffer the stages write: depth keys, then identifiers one screen further. */
const PIXELS = 1280 * 720
const work = new Uint32Array(2 * PIXELS)
const scope = {
  ...{ uni, instances: [], slotOffsets: [0], pages: table, work, ...VIS_VS_SCOPE },
  ...{ dpdx: () => [0, 0], dpdy: () => [0, 0] },
  // A checker of alpha 0 and 1 over the UV: half of a mapped cutout row's pixels are cut.
  maskAlpha: (_map: number, uv: number[]) => (Math.floor(uv[0] * 6) + Math.floor(uv[1] * 6)) % 2,
}
const names = VIS_VS_NAMES.concat(['maskKeep', 'visKey', 'vis_hiz_fs'])
/** The stage in each phase of the write (`ID_PHASE`), with its mask test (`MASKED`) or with it
 *  compiled out, the opaque twins' (`VIS_UNMASKED`). */
const stageOf = (masked: boolean, ids: boolean) =>
  stages(VIS_SHADER, names, { ...scope, MASKED: masked, ID_PHASE: ids })
const cutStages = [stageOf(true, false), stageOf(true, true)],
  opaqueStages = [stageOf(false, false), stageOf(false, true)]
type Corner = { position: number[]; id: number; instance: number; tc: number[] }
const corners = table.map((row, at) =>
  Array.from({ length: row.indexCount }, (_, v) => cutStages[0].vis_vs(v, at) as Corner),
)

const [W, H] = [96, 54]
/** The visibility buffer of every slot, each drawn with the cut stage or, `opaqueSlots`, with the
 *  opaque one when it holds no cutout row: the depth phase over every slot, then the identifier
 *  phase. */
function raster(opaqueSlots: boolean) {
  work.fill(0)
  const seen = { ties: 0, discards: 0, opaque: 0, written: 0 }
  for (const phase of [0, 1])
    for (const bin of [0, 1, 2]) {
      const rows = table.flatMap((row, at) => (binOf(row) === bin ? [at] : []))
      const opaque = opaqueSlots && rows.every((at) => !(table[at].flags & F.FLAG_MASK))
      const stage = (opaque ? opaqueStages : cutStages)[phase]
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
              const pixel = j * 1280 + i
              if (opaque) seen.opaque++
              if (phase === 0 && table[at].flags & F.FLAG_MASK) {
                const keep = (cutStages[0].maskKeep as Fn)(table[at], tc, tc[2], [0, 0], [0, 0])
                if (!keep) seen.discards++
              }
              // A fragment at the final key of a pixel another one already named: a tie the
              // identifier phase settles by its maximum.
              const key = (stage.visKey as Fn)(z, 0)
              if (phase === 1 && work[pixel] === key && work[PIXELS + pixel] !== 0) seen.ties++
              const named = work[PIXELS + pixel]
              ;(stage.vis_hiz_fs as Fn)(input)
              if (phase === 1 && work[PIXELS + pixel] !== named) seen.written++
            }
        }
    }
  return { image: work.slice(), seen }
}

test('the opaque stage on slots without a cutout row writes the same visibility buffer', () => {
  const cut = raster(false),
    opaque = raster(true)
  assert.deepStrictEqual(opaque.image, cut.image)
  assert.equal(cut.seen.opaque, 0)
  // The scene exercises what the proof is about: opaque slots, cutouts, ties, overdraw.
  assert.ok(opaque.seen.opaque > 1000, `${opaque.seen.opaque} opaque fragments`)
  assert.ok(cut.seen.discards > 100, `${cut.seen.discards} cut fragments`)
  assert.ok(cut.seen.ties > 100, `${cut.seen.ties} ties`)
  assert.equal(opaque.seen.written, cut.seen.written)
  assert.ok(cut.seen.written > 1000, `${cut.seen.written} identifier writes`)
  // The rows cover the frame, not one corner: a tenth of the model pixels hold an identifier.
  const named = cut.image.subarray(PIXELS).filter((id) => id !== 0).length
  assert.ok(named > (W * H) / 10, `${named} pixels named`)
})
