// The scene trace's bind group is made once for the resources it names, and again when one of them (or the layout) is another.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneTraceGroupBinder } from './sceneTraceGroup.ts'

test('the scene trace’s group is made again only where its layout or a resource it names moved, its entries from the binding asked', () => {
  const made: GPUBindGroupDescriptor[] = []
  const device = {
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (made.push(descriptor), descriptor),
  } as unknown as GPUDevice
  const trace = (tag: string) => ({
    params: { tag: `${tag}params` } as unknown as GPUBuffer,
    nodes: { tag: `${tag}nodes` } as unknown as GPUBuffer,
    triangles: { tag: `${tag}triangles` } as unknown as GPUBuffer,
    table: { tag: `${tag}table` } as unknown as GPUBuffer,
  })
  const layout = {} as GPUBindGroupLayout
  const a = trace('a'),
    b = trace('b')
  const bind = sceneTraceGroupBinder(device)
  const first = bind(layout, a, 3)
  assert.equal(bind(layout, a, 3), first, 'the same resources: the group held')
  assert.equal(made.length, 1)
  assert.deepEqual(
    made[0].entries,
    [a.params, a.nodes, a.triangles, a.table].map((buffer, at) => ({
      binding: 3 + at,
      resource: { buffer },
    })),
  )
  assert.notEqual(bind(layout, b, 3), first, 'a resource moved')
  assert.equal(made.length, 2)
  // Back to the first resources: the group is made for them again, never the other's kept.
  const back = bind(layout, a, 3)
  assert.equal(made.length, 3)
  assert.equal(back, made[2] as unknown)
  bind({} as GPUBindGroupLayout, a, 3)
  assert.equal(made.length, 4, 'another layout')
})
