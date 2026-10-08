// No list-size cliff: a view that asks more than the list one binding holds is cut again on the
// GPU under a coarser projected-error threshold — one factor on the view's own — until its lists
// fit, and draws whole; the factor holds while the view does and comes back to 1 once it asks
// less. Below the device's list nothing changes. On a generated world, each readback what the
// kernels' oracle cuts under the threshold the cut wrote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { world, worldCut } from './listCoarsen.fixture.ts'

const NEAR = 16,
  FAR = 1500

/** The ranks the near view asks at full detail, and the far one. */
function demands() {
  const probe = world(),
    near = probe.lists(probe.view(NEAR)),
    far = probe.lists(probe.view(FAR))
  const ranks = (l: { asked: number[]; drawn: number[] }) =>
    Math.max(l.asked.length, l.drawn.length)
  return { near: ranks(near), far: ranks(far) }
}

test('a view past the device list coarsens on the GPU and draws whole, untruncated', async () => {
  const { near } = demands()
  const cap = Math.floor(near / 3)
  const { resources, selection, frame, threshold, view, lists, fake } = await worldCut(cap)
  assert.equal(resources.listCap, cap, 'the device holds no more')
  await frame(view(FAR))
  // The view comes near: what the host writes in that frame, cuts again included, is the cut's
  // uniforms alone — no placement walked nor sent, no table rewritten.
  const before = fake.writes.length
  const uniforms = view(NEAR)
  const cut = await frame(uniforms)
  const hostWrites = fake.writes.slice(before).filter((w) => w.buffer !== resources.uniforms)
  assert.deepEqual(hostWrites, [], 'the uniforms alone')
  assert.equal(cut?.result.truncated, false, 'the readout handed over is whole')
  assert.ok(selection.coarsen > 1, `factor ${selection.coarsen}`)
  assert.equal(resources.listCap, cap, 'no list past the device')
  assert.equal(threshold(), Math.fround(uniforms.pixelError * selection.coarsen))
  const coarse = lists(uniforms, threshold())
  assert.deepEqual(cut?.result.drawablePageIds, coarse.drawn, 'every cluster the cut drew')
  assert.ok(coarse.drawn.length <= cap && coarse.drawn.length > 0)
  // The next images under the same view: the cut stands, and the host writes nothing.
  const writes = fake.writes.length
  for (let k = 0; k < 4; k++) assert.equal(await frame(uniforms), cut, `image ${k}: the cut held`)
  assert.equal(fake.writes.length, writes, 'nothing written by the host')
})

test('the factor holds while the view asks the same, and returns to 1 when it shrinks', async () => {
  const { near, far } = demands()
  const cap = Math.floor(near / 3)
  assert.ok(far <= cap / 8, `the far view asks ${far} of ${cap}`)
  const { selection, frame, threshold, view, lists } = await worldCut(cap)
  await frame(view(NEAR))
  const raised = selection.coarsen
  // A camera that drifts a little keeps its factor: no image after image flips.
  for (let k = 1; k <= 4; k++) {
    await frame(view(NEAR + k * 0.01))
    assert.equal(selection.coarsen, raised, `image ${k}`)
  }
  const back = view(FAR)
  const cut = await frame(back)
  assert.equal(selection.coarsen, 1)
  assert.equal(threshold(), Math.fround(back.pixelError))
  assert.deepEqual(cut?.result.drawablePageIds, lists(back).drawn, 'the view’s own cut')
})

test('below the device list the cut and its threshold are the view’s own', async () => {
  const { near } = demands()
  const { resources, selection, frame, threshold, view, lists } = await worldCut(2 * near)
  const uniforms = view(NEAR)
  const cut = await frame(uniforms)
  assert.equal(selection.coarsen, 1)
  assert.equal(threshold(), Math.fround(uniforms.pixelError), 'the threshold bit for bit')
  const full = lists(uniforms)
  assert.equal(cut?.result.truncated, false)
  assert.deepEqual(cut?.result.drawablePageIds, full.drawn)
  assert.deepEqual(cut?.result.pageIds, full.asked)
  assert.ok(resources.listCap >= near, 'the list holds the whole cut')
})
