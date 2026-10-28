// The maps' cache empties itself when what its pages hold changes — a setting of the pages, the tessellation's capacity, the scale of the level of detail —, once; a setting that
// moves no page, and the first reading, drop nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { followCacheContent } from './cacheContent.ts'

function runtime() {
  let dropped = 0
  const rt = {
    context: {} as Record<string, unknown>,
    vis: { materialTable: { displaced: { count: 1, ints: new Uint32Array(0) } } },
    gpu: {},
    services: { residency: { qualityScale: 1 } },
    run: { frame: 0 },
    lights: { vsm: { state: { cache: { invalidate: () => void dropped++ } } } },
  }
  /** One image: the frame number moves, so the scale of the level of detail is worked out again. */
  const follow = () => {
    rt.run.frame++
    followCacheContent(rt as never)
    return dropped
  }
  return { rt, follow }
}

test('a change of what the pages hold empties the cache once; the first reading and a setting that moves no page do not', () => {
  const { rt, follow } = runtime()
  assert.equal(follow(), 0, 'the first reading keeps the key and drops nothing')
  assert.equal(follow(), 0, 'an unchanged key drops nothing')
  rt.context.shadowDistanceScale = 0.5
  assert.equal(follow(), 0, 'the distance scale moves no page')
  rt.context.shadowGeometryLodBias = 2
  assert.equal(follow(), 1, 'the level of detail of the casters')
  assert.equal(follow(), 1, 'once')
  rt.context.shadowMaxResolution = 1024
  assert.equal(follow(), 2, 'the resolution')
  rt.context.tessellationMaxCandidatePatches = 2000
  assert.equal(follow(), 3, 'the tessellation’s capacity')
  rt.services.residency.qualityScale = 0.5
  assert.equal(follow(), 4, 'the scale of the level of detail, by the streaming quality')
})

test('the tessellation turned off and on again, or first made, empties the cache: its capacity is none while off', () => {
  const { rt, follow } = runtime()
  rt.vis.materialTable.displaced.count = 0
  assert.equal(follow(), 0, 'no displaced surface: the key holds no capacity')
  rt.vis.materialTable.displaced.count = 1
  assert.equal(follow(), 1, 'the first tessellation: the pages drawn flat are drawn again')
  rt.vis.materialTable.displaced.count = 0
  assert.equal(follow(), 2, 'given back: the displaced silhouette is gone from the pages')
  rt.vis.materialTable.displaced.count = 1
  assert.equal(follow(), 3, 'made again')
})
