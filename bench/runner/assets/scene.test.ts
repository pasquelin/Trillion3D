import test from 'node:test'
import assert from 'node:assert/strict'
import { applySceneFlag, DEFAULT_SCENE, REFERENCE_SCENES, sceneDerived, sceneOf } from './scene.ts'
import { catalogueScenes } from './assetsCatalogue.ts'
import { parseArgs } from '../harness/flags.ts'

test('the reference scenes are the public ones, the cut first and the mirror next', () => {
  assert.deepEqual(REFERENCE_SCENES, ['sponza', 'normal-tangent-mirror-test'])
  assert.equal(DEFAULT_SCENE, 'sponza')
  // Both are catalogue models: what the bench names, `assets.ts` knows how to fetch.
  for (const scene of REFERENCE_SCENES) assert.ok(catalogueScenes().includes(scene), scene)
})

test('applySceneFlag sets the derived cache on sides that do not have one', () => {
  const flags = parseArgs(['--scene', 'flight-helmet', '--before', 'dist'])
  applySceneFlag(flags, '/assets')
  assert.equal(flags.get('cache-after'), sceneDerived('flight-helmet', '/assets'))
  assert.equal(flags.get('cache-before'), sceneDerived('flight-helmet', '/assets'))
})

test('sceneOf infers the scene from its cache folder', () => {
  assert.equal(sceneOf('/x/flight-helmet-derived'), 'flight-helmet')
})
