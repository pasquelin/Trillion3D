// A page record carries no placement values. Every reader takes the world, the row
// and the winding from the root that places it, so a placement is never copied
// into each of its pages.
// The cut publishes its instances as packed catalogue ranks, and the consumers read
// a record back through the one accessor, `recordOf`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts'
import { placedSession, scaleDown } from './webgpuGrowth.fixture.ts'
import { rootOf } from '../page/selection/placements.ts'
import { CLUSTER_SPHERE_FLOATS } from '../webgpu/shadow/rowBuffers.ts'
import { MOBILITY_CORNER_SHIFT, MOBILITY_MOVING } from '../gpu/shadow/mobilityBits.ts'
import { transformAffinePoint, type SceneLight } from '../../../sdk-core/src/index.ts'
import { SUN } from '../webgpu/pages/io/memoryGrowth.fixture.ts'

type Session = Awaited<ReturnType<typeof placedSession>>

/** Word of a row holding its page's offset in the pool, in words: its address, not its placement. */
const OFFSET_WORD = 24

/** What the image is drawn from: the rows, the draw items, the corners and the cut. The pool's
 *  layout is the pool's (`gpu/page/homes.ts`): `homes` reads the offsets, which the digest leaves out. */
function digest({ rt }: Session) {
  const { rows, drawItemWords, cornerPacked } = rt.layout
  const hash = createHash('sha256')
  // Padding words hold physical-surface fields; the placement oracle compares
  // the original row contract, leaving those independently tested material words out.
  const originalWords = 64,
    stride = PAGE_INFO_STRIDE / 4
  const table = new Float32Array((rows.pageTableFloats!.length / stride) * originalWords)
  for (let row = 0; row < table.length / originalWords; row++)
    table.set(
      rows.pageTableFloats!.subarray(row * stride, row * stride + originalWords),
      row * originalWords,
    )
  for (let row = 0; row < table.length; row += originalWords)
    for (const word of [OFFSET_WORD, 38, 39, 40, 41, 44, 45, 52, 53, 58, 59]) table[row + word] = 0
  for (const words of [table, rows.packedPageIndex, drawItemWords, cornerPacked])
    hash.update(new Uint8Array(words.buffer, words.byteOffset, words.byteLength))
  // The instances as packed ranks, rank by rank: a record serves every placement.
  hash.update(
    JSON.stringify([
      rows.packedCount,
      rt.run.shownPacked.slice(0, rt.run.shown.length),
      rt.run.desiredPacked.slice(0, rt.run.desired.length),
    ]),
  )
  return hash.digest('hex').slice(0, 16)
}

/** Each row's page offset, in words, at the rows the cut published. */
const homes = ({ rt }: Session) => {
  const { rows } = rt.layout
  return Array.from(
    { length: rows.packedCount },
    (_, row) => rows.pageTableInts![row * (PAGE_INFO_STRIDE / 4) + OFFSET_WORD],
  )
}

/** A copy of what a buffer of the mocked device holds: what a pass that binds it reads. */
const held = (buffer: GPUBuffer) => (buffer as unknown as { data: Uint8Array }).data.slice().buffer

/**
 * What the virtual shadow maps' raster reads of each row it takes casters from (the table's
 * `packedCount` rows, `../webgpu/pages/render/vsm/vsmEncode.ts`): the mobility word and the world
 * sphere the session uploaded for it (`../webgpu/shadow/bounds.ts`), read back from the two buffers
 * the raster binds, beside the box of the record the row draws and the world of its placement.
 */
function casterRows({ rt }: Session) {
  const { lights, layout } = rt,
    { rows, placement, selectionRoots } = layout
  assert.ok(lights.mobilityRows && lights.spheres, 'the session keeps what the shadow raster binds')
  const words = new Uint32Array(held(lights.mobilityRows)),
    spheres = new Float32Array(held(lights.spheres.buffer))
  return Array.from({ length: rows.packedCount }, (_, row) => {
    const rec = rows.packedRecs[row]!,
      rank = placement.rootOfPacked[rows.packedPageIndex[row]],
      at = row * CLUSTER_SPHERE_FLOATS
    return {
      url: rec.url,
      min: [...rec.min],
      max: [...rec.max],
      world: Array.from(rootOf(selectionRoots, rank).world.elements),
      word: words[row],
      // The centre in split double, its float then the residue; then the radius.
      centre: [0, 1, 2].map((axis) => spheres[at + axis] + spheres[at + 4 + axis]),
      radius: spheres[at + 3],
    }
  })
}

/** The session at open, once its core node moved every placement under it, once grown: what
 *  `look` reads of each. */
async function steps<T>(look: (session: Session) => T, light?: SceneLight) {
  const session = await placedSession(5, light)
  const { core, cells, io, draw } = session
  try {
    const seen = [look(session)]
    core.position.set(0.5, 10, -0.25)
    core.rotation.set(0, 0.3, 0)
    for (let frame = 0; frame < 2; frame++) cells.frame([0, 0, 0], 100, io, noBudget)
    await draw()
    await draw()
    seen.push(look(session))
    await scaleDown(session)
    await draw()
    await draw()
    seen.push(look(session))
    return seen
  } finally {
    session.dispose()
  }
}
const noBudget = { admits: () => true, spend() {} }

test('rows, draw items and cut of repeated and moved placements are those of develop', async () => {
  // The digests exclude the pool's offsets (`OFFSET_WORD`).
  assert.deepEqual(await steps(digest), [
    '4c9667c088a4d0da',
    '52cef678cafd5756',
    'eea0d683aa3ccacb',
  ])
})

// Ground, then the two leaves' two placements each, at the homes of `pageHomes`: each page at its
// own width, in the catalogue's order — twelve bytes a triangle, three words.
test('each row names its page at the home the pool gave it, whatever the placement moved', async () => {
  const [at, moved, grown] = await steps(homes)
  assert.deepEqual(at, [0, 3, 3, 6, 6])
  assert.deepEqual([moved, grown], [at, at])
})

test('the shadow raster reads each row at its own placement, moving once that placement moved', async () => {
  // A light that casts: the shadow rows are derived only then.
  const seen = await steps(casterRows, SUN)
  // One record serves every placement of its primitive: the scene draws a record twice.
  const urls = seen[0].map((row) => row.url)
  assert.ok(new Set(urls).size < urls.length, `a record two placements draw: ${urls.join(', ')}`)
  // One triangle a row, which casts and is no cutout.
  const still = 3 << MOBILITY_CORNER_SHIFT
  const point = new Float64Array(3)
  const place = (world: number[], at: (axis: number) => number) =>
    Array.from(transformAffinePoint(point, world, at(0), at(1), at(2)))
  for (const [step, rows] of seen.entries())
    for (const [row, { url, min, max, world, word, centre, radius }] of rows.entries()) {
      const where = `${['at open', 'moved', 'grown'][step]}, row ${row} (${url})`
      // The core node moved every placement under it, the ground's aside: those turn moving, the
      // raster draws them into the dynamic slice from then on.
      assert.equal(word, step > 0 && url !== 'ground' ? still | MOBILITY_MOVING : still, where)
      // The sphere of the row's own placement: centred on the box it places, holding its eight
      // corners, and never twice as wide as the farthest.
      const middle = place(world, (axis) => (min[axis] + max[axis]) / 2)
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          Math.abs(centre[axis] - middle[axis]) <= 1e-12 * Math.max(1, Math.abs(middle[axis])),
          `${where}: centre ${centre} for ${middle}`,
        )
      let farthest = 0
      for (let corner = 0; corner < 8; corner++) {
        const p = place(world, (axis) => ((corner >> axis) & 1 ? max : min)[axis])
        farthest = Math.max(farthest, Math.hypot(...p.map((v, axis) => v - centre[axis])))
      }
      assert.ok(
        radius >= farthest && radius <= 2 * farthest,
        `${where}: radius ${radius}, farthest corner ${farthest}`,
      )
    }
})
