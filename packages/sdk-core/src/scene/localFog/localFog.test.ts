// The local fog volumes' contract and store (`./contracts.ts`, `./store.ts`): the defaults of a volume,
// every field held to its range, the sphere its matrix makes, and the store that holds them by name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { localFogRadius, resolveLocalFogVolume } from './contracts.ts'
import { createSceneLocalFogStore } from './store.ts'

test('a local fog volume: every field at its default, each held to its range, a field that is no number refused', () => {
  const bare = resolveLocalFogVolume({ id: 'a' })
  // The component's defaults: a sphere of five metres, both densities 1, a falloff of 1000, a distribution
  // of 0.2, white, no emission, no start distance, the priority 0.
  assert.deepEqual(
    { ...bare, matrix: undefined },
    {
      id: 'a',
      matrix: undefined,
      radialDensity: 1,
      heightDensity: 1,
      heightFalloff: 1000,
      heightOffset: 0,
      scatteringDistribution: 0.2,
      albedo: [1, 1, 1],
      emissive: [0, 0, 0],
      startDistance: 0,
      sortPriority: 0,
    },
  )
  assert.deepEqual(bare.matrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // The ranges: the densities and the start distance from 0, the falloff from 1, the distribution in
  // [0, 0.999], the albedo in [0, 1], the emissive from 0, the priority a whole number in [-127, 127].
  const held = resolveLocalFogVolume({
    id: 'b',
    radialDensity: -2,
    heightDensity: -1,
    heightFalloff: 0.2,
    heightOffset: -3,
    scatteringDistribution: 5,
    albedo: [2, -1, 0.5],
    emissive: [-1, 3, 0],
    startDistance: -10,
    sortPriority: 300.4,
  })
  assert.deepEqual(
    [held.radialDensity, held.heightDensity, held.heightFalloff, held.heightOffset],
    [0, 0, 1, -3],
  )
  assert.deepEqual(
    [
      held.scatteringDistribution,
      held.albedo,
      held.emissive,
      held.startDistance,
      held.sortPriority,
    ],
    [0.999, [1, 0, 0.5], [0, 3, 0], 0, 127],
  )
  assert.equal(resolveLocalFogVolume({ id: 'c', sortPriority: -3.6 }).sortPriority, -4)
  for (const wrong of [
    { id: '' },
    { id: 'd', matrix: [1, 0, 0] },
    { id: 'd', matrix: Array(16).fill(0) },
    { id: 'd', matrix: [...Array(15).fill(1), NaN] },
    { id: 'd', radialDensity: NaN },
    { id: 'd', radialDensity: null },
    { id: 'd', heightFalloff: '5' },
    { id: 'd', albedo: [1, 1] },
    { id: 'd', albedo: null },
    { id: 'd', emissive: [1, 1, Infinity] },
  ])
    assert.throws(() => resolveLocalFogVolume(wrong as never), {
      code: 'INVALID_SCENE_LOCAL_FOG_VOLUME',
    })
})

test('a local fog volume’s sphere: five metres at a scale of 1, the largest column’s length times that', () => {
  assert.equal(localFogRadius(resolveLocalFogVolume({ id: 'a' })), 5)
  const scaled = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]
  assert.equal(localFogRadius(resolveLocalFogVolume({ id: 'a', matrix: scaled })), 15)
})

test('the local fog volumes’ store: a name once, a change bumps the revision, the same volume again does not', () => {
  const store = createSceneLocalFogStore()
  assert.deepEqual([store.count, store.revision], [0, 0])
  store.add({ id: 'valley', heightDensity: 2 })
  assert.deepEqual([store.count, store.revision], [1, 1])
  assert.throws(() => store.add({ id: 'valley' }), { code: 'DUPLICATE_SCENE_LOCAL_FOG_VOLUME' })
  store.set('valley', { heightDensity: 2 })
  assert.equal(store.revision, 1, 'unchanged')
  store.set('valley', { emissive: [1, 0.5, 0] })
  assert.deepEqual([store.revision, store.get('valley')!.emissive], [2, [1, 0.5, 0]])
  assert.equal(store.get('valley')!.heightDensity, 2, 'the fields the patch leaves are kept')
  assert.throws(() => store.set('none', {}), { code: 'UNKNOWN_SCENE_LOCAL_FOG_VOLUME' })
  assert.throws(() => store.set('valley', { albedo: [1] as never }), {
    code: 'INVALID_SCENE_LOCAL_FOG_VOLUME',
  })
  store.add({ id: 'room' })
  assert.deepEqual(
    [...store.values].map((v) => v.id),
    ['valley', 'room'],
  )
  store.remove('valley')
  assert.deepEqual([store.count, store.revision], [1, 4])
  assert.throws(() => store.remove('valley'), { code: 'UNKNOWN_SCENE_LOCAL_FOG_VOLUME' })
})
