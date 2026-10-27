import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { REPOSITORY_ROOT } from '../../git/repository-files.ts'
import {
  HEAD_RADIUS,
  hairStrandsExample,
  POINTS_PER_STRAND,
  ROOT_WIDTH,
  STRAND_COUNT,
  STRAND_LENGTH,
  TIP_WIDTH,
} from './hair-strands/model.ts'
import { hairStrandsUsda } from './hair-strands/write.ts'

const committed = resolve(REPOSITORY_ROOT, 'tests/fixtures/scenes/hair-strands')

test('the hair example is deterministic, finite and made of the strands it says', () => {
  const first = hairStrandsExample(),
    second = hairStrandsExample()
  assert.deepEqual(first, second)
  assert.equal(first.counts.length, STRAND_COUNT)
  assert.ok(first.counts.every((count) => count === POINTS_PER_STRAND))
  assert.equal(first.points.length, STRAND_COUNT * POINTS_PER_STRAND * 3)
  assert.equal(first.widths.length, STRAND_COUNT * POINTS_PER_STRAND)
  assert.ok(first.points.every(Number.isFinite))
  assert.ok(first.scalp.indices.every((i) => i >= 0 && i < first.scalp.points.length / 3))
})

test('each strand is rooted on the sphere and tapers from the root width to the tip width', () => {
  const { points, widths } = hairStrandsExample()
  for (let i = 0; i < STRAND_COUNT; i++) {
    const root = i * POINTS_PER_STRAND
    const x = points[root * 3]!,
      y = points[root * 3 + 1]! - HEAD_RADIUS,
      z = points[root * 3 + 2]!
    assert.ok(Math.abs(Math.hypot(x, y, z) - HEAD_RADIUS) < 1e-9)
    assert.equal(widths[root], ROOT_WIDTH)
    assert.ok(Math.abs(widths[root + POINTS_PER_STRAND - 1]! - TIP_WIDTH) < 1e-12)
    // Every point lies within two strand lengths of the sphere (the draw scales a length by 1.2 at
    // most, and the tip sags and wanders a little).
    for (let k = 0; k < POINTS_PER_STRAND; k++) {
      const p = (root + k) * 3
      const away = Math.hypot(points[p]!, points[p + 1]! - HEAD_RADIUS, points[p + 2]!)
      assert.ok(away >= HEAD_RADIUS - 1e-9 && away <= HEAD_RADIUS + 2 * STRAND_LENGTH)
    }
  }
})

test('the USD text holds one mesh and one linear BasisCurves of the strands', () => {
  const text = hairStrandsUsda(hairStrandsExample())
  assert.match(text, /^#usda 1\.0\n/)
  assert.equal(text.match(/def Mesh "Scalp"/g)?.length, 1)
  assert.equal(text.match(/def BasisCurves "Hair"/g)?.length, 1)
  assert.match(text, /uniform token type = "linear"/)
  assert.match(text, /int\[\] curveVertexCounts = \[8, 8,/)
  assert.equal(
    text.match(/float\[\] widths = \[([^\]]*)\]/)![1]!.split(', ').length,
    STRAND_COUNT * POINTS_PER_STRAND,
  )
})

test('the committed source is what the generator writes', async () => {
  const written = await readFile(resolve(committed, 'source/hair.usda'), 'utf8')
  assert.equal(written, hairStrandsUsda(hairStrandsExample()))
})

test('the example options turn the strands on', async () => {
  const options = JSON.parse(await readFile(resolve(committed, 'options.json'), 'utf8'))
  assert.deepEqual(options, { hairStrands: true })
})
