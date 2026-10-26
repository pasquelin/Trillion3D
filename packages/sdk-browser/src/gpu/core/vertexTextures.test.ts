// A vertex stage reads the colour atlas — an offset that reads a texture — only on a device that grants it
// the storage buffers that takes (`grantsVertexTextures`): ten.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { grantsVertexTextures } from './vertexTextures.ts'
import { shadowPageLayout } from '../../lighting/shadows/casters/pageGroup.ts'
import { visLayoutEntries } from '../../visibility/passes/shaders.ts'
import { blendLayoutEntries } from '../bind/blendBindEntries.ts'
import { BLEND_BINDINGS, VIS_BINDINGS } from '../bind/bindLayout.ts'

// Defect this test catches: an offset that reads a texture binds the colour atlas to a vertex stage
// on a device that grants it eight storage buffers — the pipeline is refused and the scene is lost —,
// or a device that grants ten never lets the offset read it.
test('a vertex stage reads the colour atlas only on a device that grants it ten storage buffers', () => {
  const grants = (limits: Record<string, number>) => grantsVertexTextures({ limits } as never)
  assert.equal(grants({ maxStorageBuffersPerShaderStage: 8 }), false)
  assert.equal(grants({ maxStorageBuffersPerShaderStage: 9 }), false)
  assert.equal(grants({ maxStorageBuffersPerShaderStage: 10 }), true)
  assert.equal(
    grants({ maxStorageBuffersPerShaderStage: 10, maxStorageBuffersInVertexStage: 9 }),
    false,
  )
  const colour = (entries: GPUBindGroupLayoutEntry[], binding: number) =>
    entries.find((entry) => entry.binding === binding)!.visibility
  for (const granted of [false, true]) {
    const device = fakeDevice(granted ? { limits: { maxStorageBuffersPerShaderStage: 10 } } : {})
    const vertex = granted ? GPUShaderStage.VERTEX : 0
    const sets = {
      'the visibility layout': visLayoutEntries(grantsVertexTextures(device.device)),
      // The fake device keeps a layout as the descriptor it was made from.
      'the shadow raster’s': (
        shadowPageLayout(device.device) as unknown as GPUBindGroupLayoutDescriptor
      ).entries as GPUBindGroupLayoutEntry[],
      'the transparents’': blendLayoutEntries(16, granted),
    }
    for (const [name, entries] of Object.entries(sets)) {
      const at = name === 'the transparents’' ? BLEND_BINDINGS.sampler : VIS_BINDINGS.sampler
      assert.equal(
        colour(entries, at) & GPUShaderStage.VERTEX,
        vertex,
        `${name}, granted ${granted}`,
      )
    }
    // Whatever it grants, a stage binds no more storage buffers than the device holds.
    const limit = granted ? 10 : 8
    for (const entries of Object.values(sets))
      assert.ok(
        stageBindingCounts({ bindGroupLayouts: [{ entries }] as never }).every(
          ({ kind, count }) => kind !== 'storage buffers' || count <= limit,
        ),
      )
  }
})
