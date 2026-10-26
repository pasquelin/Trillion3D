// The blend group's layout and its live entries are made of one table (`blendBindEntries.ts`): every
// number of `BLEND_BINDINGS` is laid out once and bound once, a binding laid out as a buffer is
// bound as one, and the view uniform is laid out at its size and bound at the size it is given.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import {
  BLEND_BINDINGS,
  BLEND_CLOUD_FOG_BINDINGS,
  BLEND_CLOUD_SHADE_BINDINGS,
} from './bindLayout.ts'
import {
  blendBindEntries,
  blendLayoutEntries,
  type BlendBindResources,
} from './blendBindEntries.ts'

const sorted = (numbers: number[]) => [...numbers].sort((a, b) => a - b)

/** The numbers of the clouds' shade and of the cloud image the vertex stage reads: bound by every
 *  group, read by the programs that read the clouds per vertex alone. */
const CLOUD_SHADE = [
  BLEND_CLOUD_SHADE_BINDINGS.block,
  BLEND_CLOUD_SHADE_BINDINGS.map0,
  BLEND_CLOUD_SHADE_BINDINGS.sampler,
]
const CLOUD_FOG = [
  BLEND_CLOUD_FOG_BINDINGS.block,
  BLEND_CLOUD_FOG_BINDINGS.colour,
  BLEND_CLOUD_FOG_BINDINGS.depth,
  BLEND_CLOUD_FOG_BINDINGS.sampler,
]
const CLOUDS = [...CLOUD_SHADE, ...CLOUD_FOG]

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
  assert.deepEqual(sorted(layout.map(({ binding }) => binding)), sorted([...numbers, ...CLOUDS]))
  assert.deepEqual(sorted(entries.map(({ binding }) => binding)), sorted([...numbers, ...CLOUDS]))
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

test('the clouds’ shade and the cloud image the translucent vertices read are seven bindings of every layout, read by the vertex stage alone', () => {
  installGpuGlobals()
  const layout = blendLayoutEntries(144)
  const cloud = layout.filter(({ binding }) => CLOUDS.includes(binding))
  assert.deepEqual(sorted(cloud.map(({ binding }) => binding)), sorted(CLOUDS))
  assert.ok(cloud.every(({ visibility }) => visibility === GPUShaderStage.VERTEX))
  const kinds = (numbers: number[]) =>
    cloud
      .filter(({ binding }) => numbers.includes(binding))
      .map((e) => (e.buffer ? 'uniform' : e.sampler ? 'sampler' : 'texture'))
      .sort()
  assert.deepEqual(kinds(CLOUD_SHADE), ['sampler', 'texture', 'uniform'])
  assert.deepEqual(kinds(CLOUD_FOG), ['sampler', 'texture', 'texture', 'uniform'])
  // The shade's after the light functions' atlas, the cloud image's past the fog's lists of tiles;
  // the fragment stage has no room for them: the binding numbers are past those it reads.
  assert.ok(CLOUDS.every((n) => n > BLEND_BINDINGS.lightFunctionAtlas))
  assert.ok(CLOUD_FOG.every((n) => n > BLEND_BINDINGS.lightFunctionAtlas + 3))
  // No layout without them: the entries bound are the layout's, program or none.
  const atlas = { views: [], pages: { buffer: {} } }
  const resources = { textures: { color: atlas, data: atlas }, uniformSize: 144 }
  const bound = blendBindEntries(resources as unknown as BlendBindResources).map(
    ({ binding }) => binding,
  )
  assert.deepEqual(sorted(bound.filter((n) => CLOUDS.includes(n))), sorted(CLOUDS))
})
