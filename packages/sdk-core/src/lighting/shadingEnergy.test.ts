// The GGX energy table (`shadingEnergy.ts`): the directional albedo of the lobe under a Fresnel of one and the share weighted by
// the Fresnel's fifth power, held as data and checked against the builder.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SHADING_ENERGY_ALONG_NORMAL,
  SHADING_ENERGY_SIZE,
  SHADING_ENERGY_TABLE,
  shadingEnergyWords,
} from './shadingEnergy.ts'
import {
  SHADING_ENERGY_SAMPLES,
  shadingEnergyTable,
  shadingEnergyTexel,
} from './shadingEnergy.fixture.ts'

const SAMPLES = 1 << 12
const at = (column: number, row: number) => (row * SHADING_ENERGY_SIZE + column) * 2

test('the table held as data is the builder’s, bit for bit as 32-bit floats, with a pair for each texel', () => {
  assert.equal(SHADING_ENERGY_TABLE.length, SHADING_ENERGY_SIZE * SHADING_ENERGY_SIZE * 2)
  const built = shadingEnergyTable(SHADING_ENERGY_SAMPLES)
  assert.deepEqual(Array.from(SHADING_ENERGY_TABLE), Array.from(built))
})

test('the column along the normal is the table’s last column, a pair for each row', () => {
  assert.equal(SHADING_ENERGY_ALONG_NORMAL.length, SHADING_ENERGY_SIZE * 2)
  for (let row = 0; row < SHADING_ENERGY_SIZE; row++)
    assert.deepEqual(
      Array.from(SHADING_ENERGY_ALONG_NORMAL.subarray(row * 2, row * 2 + 2)),
      Array.from(
        SHADING_ENERGY_TABLE.subarray(
          at(SHADING_ENERGY_SIZE - 1, row),
          at(SHADING_ENERGY_SIZE - 1, row) + 2,
        ),
      ),
    )
})

test('the words for the light buffer hold each pair in 16-bit unsigned integers, E low', () => {
  const words = shadingEnergyWords()
  assert.equal(words.length, SHADING_ENERGY_SIZE * SHADING_ENERGY_SIZE)
  for (const texel of [0, 100, 1023]) {
    const [energy, fresnel] = [SHADING_ENERGY_TABLE[texel * 2], SHADING_ENERGY_TABLE[texel * 2 + 1]]
    assert.ok(Math.abs((words[texel] & 0xffff) / 65535 - energy) <= 1 / 65535)
    assert.ok(Math.abs((words[texel] >>> 16) / 65535 - fresnel) <= 1 / 65535)
  }
})

test('a smooth lobe seen along its normal sends back all the light, none of it weighted by the fifth power', () => {
  const [energy, fresnel] = shadingEnergyTexel(1, 0.02, 3, 0, SAMPLES)
  assert.ok(energy > 0.97 && energy <= 1.02, `energy ${energy}`)
  assert.ok(fresnel < 1e-3, `fresnel ${fresnel}`)
})

test('the far corner of the table, the roughest lobe along the normal, keeps a third of the light', () => {
  const last = SHADING_ENERGY_SIZE - 1
  const [energy, fresnel] = shadingEnergyTexel(
    (last + 0.5) / SHADING_ENERGY_SIZE,
    (last + 0.5) / SHADING_ENERGY_SIZE,
    last,
    last,
    SAMPLES,
  )
  assert.ok(Math.abs(energy - 21343 / 65535) < 0.01, `corner ${energy}`)
  assert.ok(fresnel < 1e-3)
})

test('a rougher lobe keeps less of the light along the normal', () => {
  let before = Infinity
  for (let row = 0; row < SHADING_ENERGY_SIZE; row += 4) {
    const [energy] = shadingEnergyTexel(
      (SHADING_ENERGY_SIZE - 0.5) / SHADING_ENERGY_SIZE,
      (row + 0.5) / SHADING_ENERGY_SIZE,
      SHADING_ENERGY_SIZE - 1,
      row,
      SAMPLES,
    )
    assert.ok(energy <= before + 1e-3, `row ${row}`)
    before = energy
  }
})

test('at a grazing angle the share weighted by the fifth power grows with the view', () => {
  const [, along] = shadingEnergyTexel(1, 0.5, 31, 16, SAMPLES)
  const [, grazing] = shadingEnergyTexel(0.1, 0.5, 3, 16, SAMPLES)
  assert.ok(grazing > along)
})
