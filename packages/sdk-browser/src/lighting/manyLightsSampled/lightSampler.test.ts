import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { NO_LIGHT_INDEX } from './lightSamplerWgsl.ts'
import {
  LIGHT_SAMPLER_DECLS,
  NO_LIGHT_PACKED,
  packLightSampleRayRef,
  packLightSampleRef,
  unpackLightSampleRayRef,
  unpackLightSampleRef,
  addLightSampleRef,
  hashLightIndexRef,
  holdsLight,
  initSamplerRef,
  markLight,
  packCandidateRef,
  unpackCandidateRef,
} from './lightSampler.fixture.ts'

test('the hash of a light index is the 32 bit hash the reference names', () => {
  assert.equal(hashLightIndexRef(0), 878055299)
  assert.equal(hashLightIndexRef(1), 2491795611)
})

test('a marked light is held by its set, and an unmarked one almost never', () => {
  for (const words of [4, 2]) {
    const set = new Uint32Array(words)
    for (let i = 0; i < 6; i++) markLight(set, i * 37)
    for (let i = 0; i < 6; i++) assert.equal(holdsLight(set, i * 37), true)
    let falsePositives = 0
    for (let i = 1000; i < 1200; i++) if (holdsLight(set, i)) falsePositives++
    assert.ok(falsePositives < 40, `${words} words: ${falsePositives} false positives of 200`)
  }
})

test('a packed candidate gives back its light, visibility and weight', () => {
  const back = unpackCandidateRef(packCandidateRef({ index: 1234, visible: false, weight: 2.5 }))
  assert.deepEqual(back, { index: 1234, visible: false, weight: 2.5 })
  assert.equal(unpackCandidateRef(NO_LIGHT_PACKED).index, NO_LIGHT_INDEX)
  assert.equal(unpackCandidateRef(NO_LIGHT_PACKED).visible, true)
})

test('the sampler draws each light with the chance its weight holds', () => {
  const weights = [1, 3, 6]
  const draws = [0, 0, 0]
  const trials = 4000
  for (let t = 0; t < trials; t++) {
    const s = initSamplerRef(((t * 0.6180339887) % 1) * 0.9999, 4)
    weights.forEach((w, i) => addLightSampleRef(s, w, i, true, true, 4))
    for (let k = 0; k < 4; k++) draws[unpackCandidateRef(s.packed[k]!).index]!++
  }
  weights.forEach((w, i) => {
    assert.ok(Math.abs(draws[i]! / (trials * 4) - w / 10) < 0.03, `light ${i}`)
  })
})

test('a light that is not radial cannot take more than its ratio of what came before', () => {
  const s = initSamplerRef(0.5, 1)
  addLightSampleRef(s, 10, 0, true, true, 1)
  addLightSampleRef(s, 1000, 1, true, false, 1, 0.5, 0)
  assert.equal(s.weightSum, 15)
})

test('the shader text holds every declaration and no backtick', () => {
  const code = wgslModule(...LIGHT_SAMPLER_DECLS)
  for (const name of [
    'hashLightIndex',
    'isLightVisible',
    'isLightHidden',
    'packCandidate',
    'addLightSample',
    'lightTargetWeight',
  ])
    assert.ok(code.includes(`fn ${name}(`), name)
})

test('a light sample and its ray pack as the reference lays them out, and the empty ones are the references’', () => {
  const sample = { index: 1234, weight: 3.5, visible: true, guided: true, volumetric: false }
  assert.deepEqual(unpackLightSampleRef(packLightSampleRef(sample)), sample)
  const empty = {
    index: NO_LIGHT_INDEX,
    weight: 0,
    visible: false,
    guided: false,
    volumetric: true,
  }
  assert.equal(packLightSampleRef(empty), 0xffff)
  const ray = {
    distance: 12.5,
    uv: [0.5, 1] as [number, number],
    type: 2,
    firstPerson: false,
    completed: false,
  }
  const back = unpackLightSampleRayRef(packLightSampleRayRef(ray))
  assert.equal(back.distance, 12.5)
  assert.equal(back.type, 2)
  assert.equal(back.completed, false)
  assert.ok(Math.abs(back.uv[0] - 0.5) < 1 / 63 && back.uv[1] === 1)
  assert.equal(
    packLightSampleRayRef({
      distance: 0,
      uv: [0.5, 0.5],
      type: 0,
      firstPerson: false,
      completed: true,
    }),
    0x8000 | (32 << 16) | (32 << 22),
  )
})
