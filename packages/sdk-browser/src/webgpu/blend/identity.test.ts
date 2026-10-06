import test from 'node:test'
import assert from 'node:assert/strict'
import { voidStaleBlendGroups } from './identity.ts'
import { createWebgpuBlendState } from './state.ts'
import type { BlendLighting } from '../core/bindEntries.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

test('blend identity follows translucent depth independently of transmittance', () => {
  const blendState = createWebgpuBlendState()
  const rt = { gpu: {}, vis: {}, blendState } as unknown as WebgpuPagesRuntime
  const lighting = { shadowTransmittance: {}, shadowTranslucentDepth: {} } as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendState.pagedGroup = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(blendState.pagedGroup, group)
  lighting.shadowTranslucentDepth = {} as typeof lighting.shadowTranslucentDepth
  voidStaleBlendGroups(rt, lighting)
  assert.equal(blendState.pagedGroup, undefined)
})
