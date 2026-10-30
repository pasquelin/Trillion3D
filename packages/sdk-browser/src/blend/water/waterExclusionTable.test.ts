// The water's exclusion volumes: the table packing, its WGSL test against `excludes` on sample points, the variant's texts and layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { WaterExclusionVolume } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import { declaredBindings } from '../../gpu/core/wgslLayoutMatch.fixture.ts'
import { withWaterBody } from './waterBodyLane.ts'
import { NO_VERTEX_WORDS, cloudVertexText } from '../cloudVertexText.ts'
import { WATER_EXCLUSION_BINDING, WaterExclusionTable } from './waterExclusionTable.ts'
import { WATER_GROUP } from './waterLayout.ts'
import { waterWgsl } from './waterStageWgsl.ts'

/** The WGSL `waterExcluded`, mirrored on the table's words: the same reads, the same order. */
function excludedByTable(table: WaterExclusionTable, p: number[], body: number) {
  const w = table.words,
    f = new Float32Array(w.buffer)
  for (let v = 0; v < w[0]; v++) {
    const at = 4 + v * 16
    const local = [0, 4, 8].map(
      (row) =>
        f[at + row] * p[0] + f[at + row + 1] * p[1] + f[at + row + 2] * p[2] + f[at + row + 3],
    )
    if (local.some((x) => Math.abs(x) > 0.5)) continue
    let listed = false
    for (let k = w[at + 13]; k < w[at + 13] + w[at + 14]; k++)
      if (w[w[1] + k] === body) listed = true
    if (listed === (w[at + 12] === 1)) return true
  }
  return false
}

/** The text less what the variant adds: the table's block, the rank and cut functions, the cut's two tests and the label. */
function without(code: string) {
  const lines = code.split('\n'),
    from = lines.findIndex((l) => l.includes('var<storage,read> waterExclusions')),
    to = lines.findIndex((l) => l.startsWith('fn waterExcluded'))
  if (from >= 0) lines.splice(from, lines.indexOf('}', to) - from + 1)
  return lines
    .filter((l) => l !== '' && !l.startsWith('fn waterBodyRank') && !l.startsWith('fn waterCut'))
    .join('\n')
    .replaceAll('||waterCut(in)', '')
    .replace(', exclusion volumes', '')
}

const volume = (mode: 'allExceptListed' | 'onlyListed', bodies: Object3D[], x = 0, scale = 2) => {
  const v = new WaterExclusionVolume()
  v.mode = mode
  v.bodies = bodies
  v.position.set(x, 1, 0)
  v.scale.set(scale, scale, scale)
  return v
}

const plan = {}

test('the table agrees with excludes() and the box on sample points', () => {
  const lake = new Object3D(),
    pond = new Object3D()
  const ranks = new Map([
    [lake, [3, 4]],
    [pond, [7]],
  ])
  const volumes = [volume('allExceptListed', [lake]), volume('onlyListed', [pond], 10)]
  const table = new WaterExclusionTable()
  assert.equal(
    table.pack(new Set(volumes), (b) => ranks.get(b) ?? [], plan),
    true,
  )
  const owner = (rank: number) => (rank === 3 || rank === 4 ? lake : rank === 7 ? pond : undefined)
  const samples = [
    [0, 1, 0],
    [0.99, 1.99, -0.99],
    [1, 2, 1],
    [1.01, 1, 0],
    [10, 1, 0],
    [10.5, 1.4, 0.9],
    [11.2, 1, 0],
    [0, 3.1, 0],
    [-5, 1, 0],
  ]
  for (const p of samples)
    for (const rank of [3, 4, 7, 9]) {
      const expected = volumes.some(
        (v) => v.encompasses(p[0], p[1], p[2]) && v.excludes(owner(rank)),
      )
      assert.equal(excludedByTable(table, p, rank), expected, `${p} rank ${rank}`)
    }
})

test('the table is written on change only, grows to what the world holds, and skips a flat box', () => {
  const table = new WaterExclusionTable(),
    body = new Object3D()
  const v = volume('onlyListed', [body])
  const ranksOf = () => [1]
  const pack = (volumes: WaterExclusionVolume[], ranks = ranksOf) =>
    table.pack(new Set(volumes), ranks, plan)
  assert.equal(pack([v]), true)
  assert.equal(table.revision, 1, 'one rewrite, one revision')
  assert.equal(pack([v]), false, 'nothing moved')
  assert.equal(table.revision, 1, 'nothing rewritten, the revision stays')
  v.position.x = 3
  assert.equal(pack([v]), true, 'the volume moved')
  assert.equal(pack([v]), false)
  v.mode = 'allExceptListed'
  assert.equal(pack([v]), true, 'its mode changed')
  v.bodies = []
  assert.equal(pack([v]), true, 'its bodies changed')
  assert.equal(table.pack(new Set([v]), ranksOf, {}), true, 'the ranks were taken again')
  assert.equal(pack([volume('onlyListed', [body], 0, 0)]), true)
  assert.equal(table.words[0], 0, 'a flat box holds nothing')
  const many = Array.from({ length: 40 }, () => volume('allExceptListed', [body]))
  const long = () => Array.from({ length: 700 }, (_, i) => i)
  assert.equal(pack(many, long), true)
  assert.equal(table.words[0], 40, 'no volume is left out')
  assert.equal(table.words[1], 4 + 40 * 16)
  assert.equal(table.length, 4 + 40 * 16 + 40 * 700, 'no rank is left out')
  assert.equal(table.words[table.length - 1], 699)
  assert.equal(pack(many, long), false, 'grown, then unchanged')
})

test('the default texts hold nothing of the volumes; the variant adds the cut and the table alone', () => {
  const plain = wgslModule(waterWgsl({})),
    variant = wgslModule(waterWgsl({}, undefined, undefined, false, undefined, true))
  for (const word of ['waterExclusions', 'waterExcluded', 'waterCut', 'waterBodyRank'])
    assert.ok(!plain.includes(word), word)
  assert.equal(without(variant), without(plain))
  assert.equal((variant.match(/waterCut\(in\)\)\{discard/g) ?? []).length, 2, 'colour and depth')
  const bound = declaredBindings(variant).find((b) => b.name === 'waterExclusions')!
  assert.equal(bound.group, WATER_GROUP)
  assert.equal(bound.binding, WATER_EXCLUSION_BINDING)
  assert.equal(bound.bufferType, 'read-only-storage')
})

test('the body lane finds room in every program, after the lanes the others take', () => {
  const none = withWaterBody(NO_VERTEX_WORDS, { clouds: false, fog: false }, false)
  assert.deepEqual(none.extras, ['extras0'])
  assert.match(none.vertexLanes, /out\.extras0\.x=f32\(slot\.x&/)
  const both = { clouds: true, fog: true }
  const full = withWaterBody(cloudVertexText(both), both, true)
  assert.deepEqual(
    full.extras,
    ['extras0', 'extras1'],
    'fog, clouds, the object shadow and the body: two locations',
  )
  assert.match(full.vertexLanes, /out\.extras1\.z=f32\(slot\.x&/)
  const fog = withWaterBody(
    cloudVertexText({ clouds: false, fog: true }),
    { clouds: false, fog: true },
    false,
  )
  assert.deepEqual(fog.extras, ['extras0', 'extras1'])
  assert.ok(full.declared.some((d) => String(d.name ?? d).includes('WATER_BODY_RANK_WGSL')))
})
