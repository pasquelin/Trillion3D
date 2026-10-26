// The page record a pixel's identifier names is indexed once, by `pageOf`: the dynamic test comes
// from that one read (`pageIdWgsl.ts`), the velocity stage's, which writes the pixel's flags with its
// vector; the nearest velocity reads none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { FLAG_DYNAMIC, RESPONSIVE_SHIFT, responsiveCode } from '../../visibility/types.ts'
import { PAGE_OF_WGSL } from './pageIdWgsl.ts'
import { velocityShader } from './nearestVelocityWgsl.ts'
import { taaBuiltins } from './taaBuiltins.fixture.ts'

type Page = { placement: number; flags: number; deformOutput: number }
type PageOf = (id: number) => { animated: number; responsive: number }

/** `pageOf` over `records`, and the table indexes it made. */
function run(records: Page[]) {
  const indexed: number[] = []
  const pages = new Proxy(records, {
    get: (table, key) => (
      typeof key === 'string' && /^\d+$/.test(key) && indexed.push(+key),
      table[key as never]
    ),
  })
  const { pageOf } = shaderRun<{ pageOf: PageOf }>(PAGE_OF_WGSL, ['pageOf'], {
    ...taaBuiltins,
    pages,
  })
  return { pageOf, indexed }
}
const page = (placement: number, flags = 0, deformOutput = 0): Page => ({
  placement,
  flags,
  deformOutput,
})

test('the background names no row: none is read, and it is not animated', () => {
  const { pageOf, indexed } = run([page(0, FLAG_DYNAMIC)])
  assert.equal(pageOf(0).animated, 0)
  assert.deepEqual(indexed, [])
})

test('a pixel is animated where its geometry changes with no tracked deformation', () => {
  const { pageOf } = run([page(0), page(0, FLAG_DYNAMIC), page(0, FLAG_DYNAMIC, 7), page(0, 0, 7)])
  // The sky first, then each row's page, the triangle bits of the identifier below its row.
  const ids = [0, 1, 2, 3, 4].map((row) => (row ? (row << 8) | 0x2a : 0))
  assert.deepEqual(
    ids.map((id) => pageOf(id).animated),
    [0, 0, 1, 0, 0],
  )
})

test('a pixel carries the responsiveness code of its row, and the background none', () => {
  const rows = (['off', 'medium', 'full'] as const).map((level) =>
    page(0, responsiveCode(level) << RESPONSIVE_SHIFT),
  )
  const { pageOf } = run(rows)
  assert.deepEqual(
    [0, 1, 2, 3].map((row) => pageOf(row ? row << 8 : 0).responsive),
    [0, 0, 1, 3],
  )
})

test('the record is indexed once for the dynamic test', () => {
  const { pageOf, indexed } = run([page(4, FLAG_DYNAMIC), page(9, FLAG_DYNAMIC, 3)])
  for (const id of [1 << 8, (2 << 8) | 5]) {
    indexed.length = 0
    pageOf(id)
    assert.deepEqual(indexed, [(id >> 8) - 1], `identifier ${id}`)
  }
})

test('the nearest velocity reads no page record: a pixel’s flags come with its vector', () => {
  const shader = velocityShader()
  const calls = (text: string, call: string) => text.split(call).length - 1
  const body = functionsOf(shader, ['nearestVelocity'])
  for (const gone of ['pages[', 'pageOf(', 'placementOf(', 'dynamicPixel(', 'geometryIdentity(']) {
    assert.equal(calls(body, gone), 0, `nearestVelocity has no ${gone}`)
  }
  assert.equal(calls(shader, 'fn pageOf('), 0)
  assert.equal(calls(shader, 'fn dynamicPixel('), 0)
  assert.equal(calls(shader, 'fn geometryIdentity('), 0)
})
