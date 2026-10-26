// A still scene asks nothing new of the device (S20): every bind group of the shadow passes is
// made once a frame set — the two sets in turn — and kept while what it binds stays; an upload
// sends only what changed, so once its lights have settled — a new light counts as moving for its
// first 10 frames (`LightActiveFrameCount`), its maps' bias easing back meanwhile — a frame
// writes none of them (`planFrames.fixture.ts`).
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { planFrames, randomWorld, type PlanWorld } from './planFrames.fixture.ts'

/** The label of the layout a recorded group was made with. */
const layoutOf = (group: GPUBindGroupDescriptor) => (group.layout as { label?: string }).label ?? ''

/** The layouts of the groups and the buffers of the writes each of `n` frames of `world` made. */
async function frames(world: PlanWorld, n: number) {
  const run = planFrames()
  const out = []
  for (let k = 0; k < n; k++) {
    const { groups, writes } = run.frame(world)
    out.push({ groups: groups.map(layoutOf), writes: writes.map((w) => w.buffer.label ?? '') })
    // The pipelines a frame asked are compiled before the next (off-thread in production).
    await pipelinesSettled(run.fake.device)
  }
  return out
}
const only = (labels: string[], prefixes: string[]) =>
  labels.filter((l) => prefixes.some((p) => l.startsWith(p)))
/** The light active frame count (10, `cacheManager.ts`), and the frame after it. */
const SETTLED = 10 + 1
const still = () => frames({ ...randomWorld(mulberry32(3), [0, 2, 0]), boxes: [] }, SETTLED + 3)

test('a still scene makes no raster or marking group after its second frame', async () => {
  const run = await still()
  const passes = ['vsm.render', 'vsm.resetPageTable', 'vsm.initPageRects', 'vsm.markCoarse']
  // The raster's seven; the marking's clears (every map's tables, the suns' receiver cover), rects
  // and coarse pages.
  assert.ok(only(run[0].groups, passes).length >= 7 + 4, 'the first frame makes them')
  for (const f of run.slice(2)) assert.deepEqual(only(f.groups, passes), [])
})

test('the same moved boxes every frame make their invalidation groups once a frame set', async () => {
  const run = await frames(randomWorld(mulberry32(4), [0, 2, 0]), 6)
  const invalidation = ['vsm.invalidateCastPages']
  // The cache invalidates from the third frame on, which asks its pipelines; the fourth, once they
  // are compiled, makes its group 0 and the fifth the other frame set's, each with its own two over
  // the parameters, the maps, the boxes and an empty list of the rows' changes.
  const made = run.map((f) => only(f.groups, invalidation).length)
  assert.deepEqual(made.slice(0, 3), [0, 0, 0], 'the pipelines are not compiled yet')
  assert.ok(made[3] > 0 && made[4] > 0, 'the fourth and fifth frames invalidate')
  for (const f of run.slice(5)) assert.deepEqual(only(f.groups, invalidation), [])
})

test('a still scene, its lights settled, writes none of the uploads of these passes', async () => {
  const run = await still()
  const uploads = [
    ...['vsm.nextMaps', 'vsm.perPageIds', 'vsm.marking.params', 'vsm.marking.perPage'],
    // Both frame sets' projection records.
    ...['vsm.projectionData0', 'vsm.projectionData1'],
    // The raster's parameters: its views the GPU lists (`render/renderViewsWgsl.ts`), no upload.
    'vsm.render.params',
  ]
  const first = new Set(only([...run[0].writes, ...run[1].writes], uploads))
  assert.deepEqual([...first].sort(), uploads.slice().sort(), 'the first two frames write them')
  // The records take each settled bias at their own frame set's turn: one frame later for one.
  const records = uploads.filter((label) => label.startsWith('vsm.projectionData'))
  for (const [k, f] of run.slice(SETTLED).entries()) {
    const written = only(f.writes, uploads)
    assert.deepEqual(k === 0 ? written.filter((l) => !records.includes(l)) : written, [])
  }
})
