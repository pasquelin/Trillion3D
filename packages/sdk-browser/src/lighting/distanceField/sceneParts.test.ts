// The parts of the meshes' field scene that need no frame: the budget its atlas is given, whose shape
// the first settings read fix, and the one bind group, made again only when a resource is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { AtlasGpu } from './atlasGpu.ts'
import { createBudget, createSceneGroup } from './sceneParts.ts'

const settings = (changes = {}) => resolveSettings(GLOBAL_DISTANCE_FIELD_RULES, changes)

test('the atlas’s shape is read from the first settings, its other limits from each', () => {
  const budget = createBudget()
  const first = budget(
    settings({ meshDistanceFieldBrickAtlasSize: 1100, meshDistanceFieldBlockBricks: 4 }),
  )
  assert.deepEqual([first.sizeXY, first.blockBricks], [1024, 4], 'a power of two, rounded down')
  const later = budget(
    settings({
      ...{ meshDistanceFieldBrickAtlasSize: 4096, meshDistanceFieldBlockBricks: 8 },
      ...{ meshDistanceFieldBrickAtlasDepth: 3, meshDistanceFieldUploadKiB: 2 },
      meshDistanceFieldReverseAllocation: true,
    }),
  )
  assert.deepEqual([later.sizeXY, later.blockBricks], [1024, 4], 'the shape stays')
  assert.deepEqual([later.maxDepth, later.uploadBytes, later.reverseOrder], [3, 2048, true])
})

test('the bind group is made again only when a resource it names is', () => {
  let made = 0
  const device = { createBindGroup: () => ({ made: ++made }) }
  const atlas = (sceneBuffer: object) =>
    ({ sceneBuffer, records: { assets: {}, table: {} }, brickTexture: {} }) as unknown as AtlasGpu
  const objects = { bounds: {}, data: {} }
  const group = createSceneGroup(device as never, {} as GPUBindGroupLayout, objects as never)
  assert.equal(group.generation, 0, 'none before the first frame')
  // The resources a frame names: the group is made for them, and stays while they stay.
  const first = atlas({})
  const resources = { ...first, records: first.records, brickTexture: first.brickTexture }
  assert.equal(group.over(resources as AtlasGpu), true, 'made at the first frame')
  const made1 = group.current
  assert.equal(group.over(resources as AtlasGpu), false, 'the same resources: the same group')
  assert.equal(group.current, made1)
  assert.deepEqual([made, group.generation], [1, 1])
  // A buffer that grew is another resource: the group is made again.
  assert.equal(group.over({ ...resources, sceneBuffer: {} } as AtlasGpu), true)
  assert.notEqual(group.current, made1)
  assert.deepEqual([made, group.generation], [2, 2])
})
