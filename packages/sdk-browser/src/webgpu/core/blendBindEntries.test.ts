// The blend group's layout and its live entries are made of one table (`blendBindEntries.ts`): every
// number of `BLEND_BINDINGS` is laid out once and bound once, a binding laid out as a buffer is
// bound as one, and the view uniform is laid out at its size and bound at the size it is given.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { BLEND_BINDINGS } from './bindLayout.ts'
import {
  blendBindEntries,
  blendLayoutEntries,
  type BlendBindResources,
} from './blendBindEntries.ts'

const sorted = (numbers: number[]) => [...numbers].sort((a, b) => a - b)

test('the blend layout and its entries are one table over every blend binding', () => {
  installGpuGlobals()
  const layout = blendLayoutEntries(144)
  const atlas = { views: [], pages: { buffer: {} } }
  const entries = blendBindEntries({
    textures: { color: atlas, data: atlas },
    uniformSize: 144,
  } as unknown as BlendBindResources)
  const numbers = Object.values(BLEND_BINDINGS).flatMap((value) =>
    typeof value === 'number' ? [value] : [...value.lanes, value.pages],
  )
  assert.deepEqual(sorted(layout.map(({ binding }) => binding)), sorted(numbers))
  assert.deepEqual(sorted(entries.map(({ binding }) => binding)), sorted(numbers))
  for (const laid of layout) {
    const bound = entries.find(({ binding }) => binding === laid.binding)!
    const asBuffer = Object.getOwnPropertyNames(bound.resource ?? {}).includes('buffer')
    assert.equal(asBuffer, laid.buffer !== undefined, `binding ${laid.binding}`)
  }
  const uniform = layout.find(({ binding }) => binding === BLEND_BINDINGS.uniform)!
  assert.equal(uniform.buffer?.minBindingSize, 144)
  assert.equal(uniform.visibility, GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)
  const bound = entries.find(({ binding }) => binding === BLEND_BINDINGS.uniform)!
  assert.equal((bound.resource as GPUBufferBinding).size, 144)
})
