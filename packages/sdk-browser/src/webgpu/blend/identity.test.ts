import test from 'node:test'
import assert from 'node:assert/strict'
import { voidStaleBlendGroups } from './identity.ts'
import { createWebgpuBlendState } from './state.ts'
import type { BlendLighting } from '../core/bindEntries.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** The paged group of the identity the last `voidStaleBlendGroups` named. */
const pagedGroup = ({ identity, pagedGroups }: ReturnType<typeof createWebgpuBlendState>) =>
  pagedGroups[identity.slot]

test('blend identity follows translucent depth independently of transmittance', () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: {}, blendState } as unknown as WebgpuPagesRuntime
  const lighting = { shadowTransmittance: {}, shadowTranslucentDepth: {} } as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendState.pagedGroups[blendState.identity.slot] = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(pagedGroup(blendState), group)
  lighting.shadowTranslucentDepth = {} as typeof lighting.shadowTranslucentDepth
  voidStaleBlendGroups(rt, lighting)
  assert.equal(pagedGroup(blendState), undefined)
})

test("the groups over each of the shadow maps' double-buffered tables are kept while they take turns", () => {
  const blendState = createWebgpuBlendState()
  const item = {} as (typeof blendState.blendGpu)[number]
  blendState.blendGpu.push(item)
  const rt = { gpu: {}, vis: {}, blendState } as unknown as WebgpuPagesRuntime
  const tables = [{}, {}] as GPUBuffer[]
  const frame = (k: number) => {
    voidStaleBlendGroups(rt, { shadowData: tables[k % 2] } as BlendLighting)
    return blendState.identity.slot
  }
  // Each table's frame makes its groups once.
  const groups = [0, 1].map((k) => {
    const slot = frame(k),
      group = {} as GPUBindGroup
    blendState.pagedGroups[slot] = group
    ;(item.groups ??= [])[slot] = group
    return group
  })
  for (let k = 2; k < 8; k++) {
    frame(k)
    assert.equal(pagedGroup(blendState), groups[k % 2], "the shared group of this frame's table")
    assert.equal(item.groups![blendState.identity.slot], groups[k % 2], "and the item's own")
  }
  // A third table takes over the slot of the one named longest ago, and voids its groups alone.
  voidStaleBlendGroups(rt, { shadowData: {} } as BlendLighting)
  assert.equal(pagedGroup(blendState), undefined)
  assert.equal(item.groups![blendState.identity.slot], undefined)
  frame(7)
  assert.equal(pagedGroup(blendState), groups[1], 'the table named last keeps its groups')
})
