import test from 'node:test'
import assert from 'node:assert/strict'
import { StepWords, createWater, sliceLength } from './buoyancy.ts'
import { OCEAN } from './waves.fixture.ts'
import { waveHeight } from './surface.ts'
import { Waves } from './waves.ts'
import { WaterSurface } from './waterSurface.ts'
import { BUOYANCY_WORDS, OP, PLANE_WORDS } from '../physics/layout.ts'

test('steepness is normalised so that Σ Qᵢ·Aᵢ·kᵢ stays at most 1', () => {
  assert.ok(Math.abs(new Waves(OCEAN).steepness - 1) < 1e-12, 'eight waves at 0.9 scaled to 1')
  const gentle = new Waves([{ direction: [1, 0], wavelength: 10, amplitude: 0.5, steepness: 0.4 }])
  assert.ok(Math.abs(gentle.steepness - 0.4) < 1e-12, 'a sum below 1 is kept')
  assert.throws(() => new Waves([{ direction: [0, 0], wavelength: 1, amplitude: 1, steepness: 0 }]))
  assert.throws(() => new Waves([{ direction: [1, 0], wavelength: 1, amplitude: 1, steepness: 2 }]))
})

test('the height under a displaced point is that point’s height, at the steepest crest', () => {
  const waves = new Waves(OCEAN)
  waves.setTime(12.5)
  const o = new Float64Array(3)
  for (let i = 0; i < 2000; i++) {
    const x = (i % 50) * 1.37 - 30,
      z = Math.floor(i / 50) * 1.61 - 30
    waves.offset(x, z, o)
    assert.ok(Math.abs(waveHeight(waves, x + o[0], z + o[2]) - o[1]) < 1e-3, `at ${x}, ${z}`)
  }
})

test('the step words carry the water, the planes the module gave, then the page’s commands', () => {
  const water = createWater({ waves: OCEAN.slice(0, 2), level: 3, density: 800 })
  const planes = new Uint32Array(2 * PLANE_WORDS).map((_, i) => i + 1)
  const words = new StepWords()
  const length = words.write(water, planes, new Uint32Array([OP.wake, 7]))
  assert.deepEqual([words.words[0], words.words[1]], [OP.buoyancy, 2])
  assert.equal(new Float32Array(words.words.buffer)[2], 800)
  assert.deepEqual([...words.words.subarray(BUOYANCY_WORDS, length - 2)], [...planes])
  assert.deepEqual([...words.words.subarray(length - 2, length)], [OP.wake, 7])
  assert.equal(words.write(water, new Uint32Array(0), null), BUOYANCY_WORDS, 'no piece in water')
})

test('a thin piece is sampled over a square a slice fraction wide', () => {
  const water = createWater({ waves: OCEAN, level: 0 })
  assert.equal(water.sample, sliceLength(water) / 25)
  assert.equal(createWater({ waves: [], level: 0 }).sample, 1, 'level water: any square')
})

test('the drawn surface is the waves buoyancy reads: its points lie at its heights', () => {
  const surface = new WaterSurface({ waves: OCEAN, level: 2 }).setTime(7.25)
  const waves = new Waves(OCEAN)
  waves.setTime(7.25)
  const p = new Float64Array(3)
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 1.9 - 19,
      z = Math.floor(i / 20) * 2.3 - 23
    surface.point(x, z, p)
    assert.ok(Math.abs(p[1] - 2 - waveHeight(waves, p[0], p[2])) < 1e-3, `at ${x}, ${z}`)
    assert.ok(Math.abs(surface.height(p[0], p[2]) - p[1]) < 1e-3)
  }
  assert.equal(surface.crest, waves.crest)
  // Set again with its phases carried, the surface goes on from where it was.
  const again = new WaterSurface({ waves: surface.wavesNow(), level: 2 })
  assert.deepEqual(again.point(3, -4, new Float64Array(3)), surface.point(3, -4, p))
  assert.throws(() => new WaterSurface({ waves: [{ ...OCEAN[0], steepness: 2 }], level: 0 }))
})

test('a surface set again in place is the new water, a wrong wave leaving it as it was', () => {
  const surface = new WaterSurface({ waves: OCEAN, level: 2 }).setTime(3)
  const held = surface.waveModel
  surface._declare({ waves: OCEAN.slice(0, 2), level: 5 })
  assert.equal(surface.level, 5)
  assert.equal(surface.time, 0, 'its clock starts again, as the worker’s')
  assert.equal(surface.waveModel.count, 2)
  assert.notEqual(surface.waveModel, held)
  const model = surface.waveModel
  assert.throws(() => surface._declare({ waves: [{ ...OCEAN[0], steepness: 2 }], level: 0 }))
  assert.equal(surface.waveModel, model)
  assert.equal(surface.level, 5)
})

test('every displacement of a rest rectangle lies in its displacement box, a point’s its own', () => {
  const waves = new Waves(OCEAN)
  waves.setTime(41.3)
  const box = new Float64Array(6),
    o = new Float64Array(3)
  let seed = 422
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  let widest = 0
  for (let trial = 0; trial < 300; trial++) {
    const x0 = next() * 400 - 200,
      z0 = next() * 400 - 200,
      w = next() ** 3 * 40,
      d = next() ** 3 * 40
    waves.displacementBox(x0, z0, x0 + w, z0 + d, box)
    for (let s = 0; s < 400; s++) {
      waves.offset(x0 + next() * w, z0 + next() * d, o)
      for (let c = 0; c < 3; c++)
        assert.ok(o[c] >= box[c] - 1e-12 && o[c] <= box[c + 3] + 1e-12, `${trial} axis ${c}`)
    }
    widest = Math.max(widest, box[4] - box[1])
  }
  // No wider than the crest's span, which bounds every box.
  assert.ok(widest <= 2 * waves.crest + 1e-12)
  // A rectangle of no width is its point's displacement.
  waves.displacementBox(3, -7, 3, -7, box)
  waves.offset(3, -7, o)
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(box[c] - o[c]) < 1e-12 && Math.abs(box[c + 3] - o[c]) < 1e-12)
  }
})
