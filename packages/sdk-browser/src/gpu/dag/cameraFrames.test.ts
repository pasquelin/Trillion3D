// A camera cut's frame words past what one storage buffer binds: one record table whatever the
// world's size (`frameTable.ts`), bound once by the cut's one group, its kernels dispatched once
// each — no range, no per-range group, no `SPLIT` stage. That the cut on such a device cuts as the
// whole one is the GPU's to prove (`tests/gpu/dag/frame-ranges.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDagResources } from './resources.ts'
import { packDagSelection } from './pack.ts'
import { primitiveWordAt } from './worlds.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { dagBindingOf } from './shader/bindings.fixture.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { fieldStart } from '../core/recordLayout.ts'

/** Forty-eight placements of the fixture's primitive, each `k + 1` metres along x — a translation
 *  a new table does not hold already —, on a device whose storage binding holds twenty rows of
 *  frame words. */
async function narrow() {
  const [root] = packed(dagFixture()).roots
  const along = (k: number) => {
    const elements = Array.from(root.world.elements)
    elements[12] += k + 1
    return { ...root, world: { elements } }
  }
  const dag = packDagSelection(Array.from({ length: 48 }, (_, k) => along(k)))
  const limits = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 20 * FRAME_ROW_WORDS * 4 }
  const fake = fakeDevice({ limits: { ...limits, maxStorageBuffersPerShaderStage: 16 } })
  const resources = await createDagResources(fake.device, dag)
  assert.ok(resources)
  return { fake, resources }
}

test('the frame words are one record table the cut binds once, whatever one binding holds', async () => {
  const { resources } = await narrow()
  const { frames, bindGroup } = resources
  const entries = Array.from((bindGroup as unknown as GPUBindGroupDescriptor).entries)
  const at = (binding: number) => entries.find((e) => e.binding === binding)?.resource
  const binding = dagBindingOf()
  assert.equal(at(binding.frames), frames.rows.view, 'the frame words, a view')
  assert.equal(at(binding.worlds), frames.worlds.view, 'the worlds, a view')
  assert.ok(!('range' in binding), 'no range a group is told of')
  const constants = (resources.preparePipeline as unknown as GPUProgrammableStage).constants
  assert.equal(constants, undefined, 'the stages of a whole table')
})

test("the host's rows and words land at their placement's record", async () => {
  const { fake, resources } = await narrow()
  const { frames, frameData } = resources
  const rows = fake.textureWrites.filter((w) => w.destination.texture === frames.rows.texture)
  const texels = (w: (typeof rows)[number]) =>
    `${(w.destination.origin as number[])[0]}+${(w.size as number[])[0]}`
  // The 48 rows in one write, eight words each, from the table's first texel.
  assert.equal(rows.map(texels).join(' '), `0+${48 * FRAME_ROW_WORDS}`)
  // The worlds: one write of the 48 matrices, four texels each, and one of their exact
  // translations, two texels each, beside them in the table's row (`worldTable.ts`). A translation
  // the new table holds already — zero — is never sent (`worldOrigins.ts`).
  const worlds = fake.textureWrites.filter((w) => w.destination.texture === frames.worlds.texture)
  assert.equal(worlds.map(texels).join(' '), '0+192 4096+96')
  const before = fake.textureWrites.length
  frames.writeWord(25, 1, 7)
  frames.flushWords()
  const sent = fake.textureWrites.slice(before)
  assert.equal(sent.map(texels).join(' '), `${fieldStart(FRAME_TABLE, 'Row') + 25 * 8}+8`)
  const words = (frames.rows.texture as unknown as { words: Uint32Array }).words
  assert.equal(words[25 * FRAME_ROW_WORDS + 1], 7, 'its row, its root word')
  assert.equal(new Uint32Array(frameData.buffer)[primitiveWordAt(25) + 1], 7)
})
