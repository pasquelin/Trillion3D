import test from 'node:test'
import assert from 'node:assert/strict'
import { blendGroupsOf, voidStaleBlendGroups } from './identity.ts'
import { createWebgpuBlendState } from './state.ts'
import type { BlendLighting } from '../gpu/bind/blendBindEntries.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** The shared group of the identity the last `voidStaleBlendGroups` named. */
const sharedGroup = (rt: WebgpuPagesRuntime) => {
  const { identity, sharedGroups } = blendGroupsOf(rt)
  return sharedGroups[identity.slot]
}

test('blend identity follows the shadow pool', () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: { materialTable: {} }, blendState } as unknown as WebgpuPagesRuntime
  const lighting = { shadowPool: {} } as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendGroupsOf(rt).sharedGroups[blendGroupsOf(rt).identity.slot] = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(rt), group)
  lighting.shadowPool = {} as typeof lighting.shadowPool
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(rt), undefined)
})

test("the groups over each of the shadow maps' double-buffered tables are kept while they take turns", () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: { materialTable: {} }, blendState } as unknown as WebgpuPagesRuntime
  const tables = [{}, {}] as GPUBuffer[]
  const frame = (k: number) => {
    voidStaleBlendGroups(rt, { shadowData: tables[k % 2] } as BlendLighting)
    return blendGroupsOf(rt).identity.slot
  }
  // Each table's frame makes its groups once.
  const groups = [0, 1].map((k) => {
    const slot = frame(k),
      group = {} as GPUBindGroup
    blendGroupsOf(rt).sharedGroups[slot] = group
    return group
  })
  for (let k = 2; k < 8; k++) {
    frame(k)
    assert.equal(sharedGroup(rt), groups[k % 2], "the shared group of this frame's table")
  }
  // A third table takes over the slot of the one named longest ago, and voids its groups alone.
  voidStaleBlendGroups(rt, { shadowData: {} } as BlendLighting)
  assert.equal(sharedGroup(rt), undefined)
  frame(7)
  assert.equal(sharedGroup(rt), groups[1], 'the table named last keeps its groups')
})

test('a grown material table, a new texture, voids the blend groups', () => {
  const blendState = createWebgpuBlendState()
  const materialTable = { view: {} as GPUTextureView }
  const rt = { gpu: {}, vis: { materialTable }, blendState } as unknown as WebgpuPagesRuntime
  const lighting = {} as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendGroupsOf(rt).sharedGroups[blendGroupsOf(rt).identity.slot] = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(rt), group)
  materialTable.view = {} as GPUTextureView
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(rt), undefined)
})

test('each view keeps its own groups: one view binding other resources voids none of another', () => {
  const blendState = createWebgpuBlendState()
  const main = {
    gpu: { viewKey: {} },
    vis: { materialTable: {} },
    blendState,
  } as unknown as WebgpuPagesRuntime
  const face = { ...main, gpu: { viewKey: {} } } as WebgpuPagesRuntime
  const lit = { shadowData: {} } as BlendLighting
  voidStaleBlendGroups(main, lit)
  const group = {} as GPUBindGroup
  blendGroupsOf(main).sharedGroups[blendGroupsOf(main).identity.slot] = group
  for (let k = 0; k < 8; k++) voidStaleBlendGroups(face, { shadowData: {} } as BlendLighting)
  voidStaleBlendGroups(main, lit)
  assert.equal(sharedGroup(main), group)
  assert.notEqual(blendGroupsOf(main), blendGroupsOf(face))
})
