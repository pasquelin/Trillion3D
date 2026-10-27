// The GGX energy table (`shadingEnergy.ts`): the directional albedo of the lobe under a Fresnel of one and the share weighted by
// the Fresnel's fifth power, the column a view along the normal reads, held as data and checked against the builder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SHADING_ENERGY_ALONG_NORMAL, SHADING_ENERGY_SIZE } from './shadingEnergy.ts'
import {
  SHADING_ENERGY_SAMPLES,
  shadingEnergyAlongNormal,
  shadingEnergyTexel,
} from './shadingEnergy.fixture.ts'

const SAMPLES = 1 << 12

test('the column held as data is the builder’s, bit for bit as 32-bit floats, with a pair for each row', () => {
  assert.equal(SHADING_ENERGY_ALONG_NORMAL.length, SHADING_ENERGY_SIZE * 2)
  const built = shadingEnergyAlongNormal(SHADING_ENERGY_SAMPLES)
  assert.deepEqual(Array.from(SHADING_ENERGY_ALONG_NORMAL), Array.from(built))
})

test('a smooth lobe seen along its normal sends back all the light, none of it weighted by the fifth power', () => {
  const [energy, fresnel] = shadingEnergyTexel(1, 0.02, SAMPLES)
  assert.ok(energy > 0.97 && energy <= 1.02, `energy ${energy}`)
  assert.ok(fresnel < 1e-3, `fresnel ${fresnel}`)
})

test('the far corner of the table, the roughest lobe along the normal, keeps a third of the light', () => {
  // The tabulated value of the corner is 21343 / 65535 of 16 bits, and 2 / 65535 for the share weighted by the fifth power.
  const last = SHADING_ENERGY_SIZE - 1
  assert.ok(
    Math.abs(SHADING_ENERGY_ALONG_NORMAL[last * 2] - 21343 / 65535) < 0.01,
    `corner ${SHADING_ENERGY_ALONG_NORMAL[last * 2]}`,
  )
  assert.ok(SHADING_ENERGY_ALONG_NORMAL[last * 2 + 1] < 1e-3)
})

test('a rougher lobe keeps less of the light along the normal', () => {
  for (let row = 1; row < SHADING_ENERGY_SIZE; row++)
    assert.ok(
      SHADING_ENERGY_ALONG_NORMAL[row * 2] <= SHADING_ENERGY_ALONG_NORMAL[(row - 1) * 2],
      `row ${row}`,
    )
})

test('at a grazing angle the share weighted by the fifth power grows with the view', () => {
  const [, along] = shadingEnergyTexel(1, 0.5, SAMPLES)
  const [, grazing] = shadingEnergyTexel(0.1, 0.5, SAMPLES)
  assert.ok(grazing > along)
})
