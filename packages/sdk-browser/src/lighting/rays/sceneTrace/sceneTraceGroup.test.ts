// The scene trace's bind group holds the trace's resources and its any-hit test's, and is made again only where the layout or one of them moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneMaskBindings } from './sceneMaskWgsl.ts'
import { sceneTraceGroupBinder } from './sceneTraceGroup.ts'
import { sceneMaskNone } from './sceneMaskNone.ts'
import { ensureTrace, fileOf, testHold } from './sceneTraceTable.fixture.ts'
import { PREVIEW_LAYOUT_NAMES } from '../../../../../sdk-core/src/texture/previewFormat.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

const buffer = (tag: string) => ({ tag }) as unknown as GPUBuffer
const views = [1, 2, 3] as unknown as GPUTextureView[]
const sampler = {} as GPUSampler
const trace = (tag: string, pages = buffer(`${tag}pages`)) => ({
  params: buffer(`${tag}params`),
  geometry: buffer(`${tag}geometry`),
  table: buffer(`${tag}table`),
  maskReads: {
    color: { views, pages: { buffer: pages } },
    sampler,
    table: {} as GPUTextureView,
    frame: buffer(`${tag}frame`),
  },
})
const recorder = () => {
  const made: GPUBindGroupDescriptor[] = []
  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice
  return { made, bind: sceneTraceGroupBinder(device) }
}

test('the scene trace’s group is made again only where its layout or a resource it names moved', () => {
  const { made, bind } = recorder()
  const layout = {} as GPUBindGroupLayout
  const a = trace('a'),
    b = trace('b')
  const first = bind(layout, a, 3)
  assert.equal(bind(layout, a, 3), first, 'the same resources: the group held')
  assert.equal(made.length, 1)
  assert.notEqual(bind(layout, b, 3), first, 'a resource moved')
  assert.equal(made.length, 2)
  // Back to the first resources: the group is made for them again, never the other's kept.
  assert.equal(bind(layout, a, 3), made[2] as unknown)
  assert.equal(made.length, 3)
  bind({} as GPUBindGroupLayout, a, 3)
  assert.equal(made.length, 4, 'another layout')
})

test('the group names the trace’s three, then the lanes, the page table, the sampler, the records and the graph frame of the any-hit test, from the binding asked', () => {
  const { made, bind } = recorder()
  bind({} as GPUBindGroupLayout, trace('a'), 3)
  const bindings = [...made[0].entries].map((entry) => entry.binding)
  const m = sceneMaskBindings(3)
  assert.deepEqual(bindings, [
    3,
    4,
    5,
    ...m.color.lanes,
    m.color.pages,
    m.sampler,
    m.table,
    m.frame,
  ])
})

test('the colour atlas moving makes the group again', () => {
  const { made, bind } = recorder()
  const layout = {} as GPUBindGroupLayout
  bind(layout, trace('a', buffer('pages')), 0)
  bind(layout, trace('a', buffer('grown')), 0)
  assert.equal(made.length, 2, 'the page table moved')
})

test('a scene trace names a stand-in atlas for its any-hit test until the lighting names the real one, so that no pass can throw', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const made: GPUBindGroupDescriptor[] = []
  const bind = sceneTraceGroupBinder({
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice)
  const sceneTrace = ensureTrace(hold, undefined, device, fileOf(), 3).sceneTrace!
  assert.equal(sceneTrace.maskReads, sceneMaskNone(device), 'the device’s one stand-in')
  assert.equal(sceneTrace.maskReads.color.views.length, PREVIEW_LAYOUT_NAMES.length)
  bind({} as GPUBindGroupLayout, sceneTrace, 0)
  assert.equal([...made[0].entries].length, 3 + PREVIEW_LAYOUT_NAMES.length + 4)
})
