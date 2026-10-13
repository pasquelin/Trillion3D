// The coplanar layers a source brings are granted in place (`layerGrowth.ts`): a session opened on
// pages of layer 0 draws one set of slots; a source whose pages stack three layers deep joins it, and
// the compaction, the layers' pipelines and the visibility uniforms are those of a session opened on
// all of them, the roots joined in the cut that drew the world — no other opened.
import test from 'node:test'
import assert from 'node:assert/strict'
import { primitive, session } from '../../../placement/appendSession.fixture.ts'
import { BASE_SLOTS, slotCount } from '../../../gpu/draw/draw.ts'
import { visUniformLayout } from '../../core/bindLayout.ts'
import { visUniformSlots } from '../../visibility/uniforms.ts'
import { MAX_DEPTH_LAYER } from '../../../../../sdk-core/src/index.ts'

test('a source whose pages stack deeper than the session’s slots is granted the slots it needs', async () => {
  const world = await session(1_000)
  try {
    const { vis } = world.rt
    // The first growth makes the cut over the world at a grown capacity: the cut the next join finds.
    assert.equal((await world.join(1)).refused, undefined)
    assert.equal(vis.drawLayerSlots, 1, 'opened on pages of layer 0')
    const draw = vis.gpuDraw!
    const pipelines = vis.visLayerPipelines.length
    assert.equal(pipelines, 0)
    const joined = await world.join(4, primitive(8, 'other', 2))
    assert.equal(joined.refused, undefined)
    assert.ok(joined.same, 'the cut that drew the world draws it still')
    assert.equal(vis.drawLayerSlots, 3, 'the layers it stacks, and layer 0')
    assert.notEqual(vis.gpuDraw, draw, 'the compaction made again for them')
    assert.equal(vis.gpuDraw!.slots, slotCount(3))
    assert.equal(vis.gpuDraw!.slots, 3 * BASE_SLOTS)
    assert.ok(vis.visLayerPipelines.length > pipelines, 'a pipeline of each layer’s depth bias')
    const device = world.rt.gpu.device!
    assert.ok(
      vis.visUniform!.size >= visUniformLayout(device.limits, visUniformSlots(vis)).bytes,
      'a uniform slot for each draw slot',
    )
  } finally {
    world.dispose()
  }
})

test('a source whose layers the slots hold takes none, and one past the cache’s deepest is held to it', async () => {
  const world = await session(1_000)
  try {
    const { vis } = world.rt
    assert.equal((await world.join(2, primitive(8, 'other', 2))).refused, undefined)
    const draw = vis.gpuDraw!,
      pipelines = vis.visLayerPipelines
    assert.equal((await world.join(2, primitive(9, 'other', 1))).refused, undefined)
    assert.equal(vis.gpuDraw, draw, 'layer 1 is held: the compaction stays')
    assert.equal(vis.visLayerPipelines, pipelines)
    assert.equal(vis.drawLayerSlots, 3)
    assert.equal((await world.join(2, primitive(10, 'other', 99))).refused, undefined)
    assert.equal(vis.drawLayerSlots, 1 + MAX_DEPTH_LAYER, 'no deeper than the cache describes')
  } finally {
    world.dispose()
  }
})
