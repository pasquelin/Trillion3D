import test from 'node:test'
import assert from 'node:assert/strict'
import { voidStaleBlendGroups } from './identity.ts'
import { createWebgpuBlendState, type WebgpuBlendState } from './state.ts'
import type { BlendLighting } from '../gpu/bind/blendBindEntries.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/** The shared group of the identity the last `voidStaleBlendGroups` named. */
const sharedGroup = ({ identity, sharedGroups }: WebgpuBlendState) => sharedGroups[identity.slot]

test('blend identity follows the shadow pool independently of transmittance', () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: { materialTable: {} }, blendState } as unknown as WebgpuPagesRuntime
  const lighting = { shadowTransmittance: {}, shadowPool: {} } as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendState.sharedGroups[blendState.identity.slot] = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(blendState), group)
  lighting.shadowPool = {} as typeof lighting.shadowPool
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(blendState), undefined)
})

test("the groups over each of the shadow maps' double-buffered tables are kept while they take turns", () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: { materialTable: {} }, blendState } as unknown as WebgpuPagesRuntime
  const tables = [{}, {}] as GPUBuffer[]
  const frame = (k: number) => {
    voidStaleBlendGroups(rt, { shadowData: tables[k % 2] } as BlendLighting)
    return blendState.identity.slot
  }
  // Each table's frame makes its groups once.
  const groups = [0, 1].map((k) => {
    const slot = frame(k),
      group = {} as GPUBindGroup
    blendState.sharedGroups[slot] = group
    return group
  })
  for (let k = 2; k < 8; k++) {
    frame(k)
    assert.equal(sharedGroup(blendState), groups[k % 2], "the shared group of this frame's table")
  }
  // A third table takes over the slot of the one named longest ago, and voids its groups alone.
  voidStaleBlendGroups(rt, { shadowData: {} } as BlendLighting)
  assert.equal(sharedGroup(blendState), undefined)
  frame(7)
  assert.equal(sharedGroup(blendState), groups[1], 'the table named last keeps its groups')
})

test('a grown material table, a new texture, voids the blend groups', () => {
  const blendState = createWebgpuBlendState()
  const materialTable = { view: {} as GPUTextureView }
  const rt = { gpu: {}, vis: { materialTable }, blendState } as unknown as WebgpuPagesRuntime
  const lighting = {} as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendState.sharedGroups[blendState.identity.slot] = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(blendState), group)
  materialTable.view = {} as GPUTextureView
  voidStaleBlendGroups(rt, lighting)
  assert.equal(sharedGroup(blendState), undefined)
})
