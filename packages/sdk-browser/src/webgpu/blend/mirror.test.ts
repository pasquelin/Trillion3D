import { withScreenReflections } from '../../reflections/screenWgsl.ts'
import test from 'node:test'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './items.ts'
import { SURFACE_MODEL } from '../../scene/surfaceModel.ts'
import assert from 'node:assert/strict'
import { voidStaleBlendGroups } from './identity.ts'
import { createWebgpuBlendState } from './state.ts'
import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../core/bindEntries.ts'
import { BLEND_BINDINGS } from '../core/bindLayout.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { functionText } from '../../bounce/wgslBody.fixture.ts'
import { BLEND_SHADER, BOUNCE_LIGHTING_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'

test('transparent mirrors use the opaque reflection model and bind its surface radiance', () => {
  for (const name of ['mirrorLighting', 'reflectedRadiance', 'rayRadiance'])
    assert.equal(
      functionText(BLEND_SHADER, name),
      functionText(withScreenReflections(BOUNCE_LIGHTING_SHADER), name),
    )
  assert.match(BLEND_SHADER, /rgb\+=mirrorLighting\(s.rgb,m,clamped,s.N,V,in.view\)/)
  const surfaceCache = {} as GPUTextureView
  const atlas = { views: [], pages: { buffer: {} } }
  const entries = blendBindEntries({
    surfaceCache,
    textures: { color: atlas, data: atlas },
  } as unknown as BlendBindResources)
  const binding = entries.find((entry) => entry.binding === BLEND_BINDINGS.surfaceCache)
  // The whole cache atlas is bound, its view as-is.
  assert.equal(binding?.resource, surfaceCache)
})

test('a replaced surface cache invalidates both blend groups, unchanged radiance storage does not', () => {
  const blendState = createWebgpuBlendState()
  const item = { group: undefined as GPUBindGroup | undefined }
  blendState.blendGpu.push(item as (typeof blendState.blendGpu)[number])
  const rt = { gpu: {}, vis: {}, blendState } as unknown as WebgpuPagesRuntime
  const lighting = { surfaceCache: {} } as BlendLighting
  voidStaleBlendGroups(rt, lighting)
  const group = {} as GPUBindGroup
  blendState.pagedGroup = group
  item.group = group
  voidStaleBlendGroups(rt, lighting)
  assert.equal(blendState.pagedGroup, group)
  assert.equal(item.group, group)
  lighting.surfaceCache = {} as GPUTextureView
  voidStaleBlendGroups(rt, lighting)
  assert.equal(blendState.pagedGroup, undefined)
  assert.equal(item.group, undefined)
})

test('accepted diffuse/toon roughness maps retain their model in the transparent record', () => {
  const roughnessMap = new G.GraphTexture()
  for (const [family, model] of [
    ['standard', SURFACE_MODEL.standard],
    ['lambert', SURFACE_MODEL.diffuse],
    ['toon', SURFACE_MODEL.toon],
  ] as const) {
    const material = new G.GraphSurface(family, { transparent: true, roughnessMap })
    const surface = surfaceOf(material)
    const floats = new Float32Array(BLEND_ITEM_WORDS)
    const ints = new Uint32Array(floats.buffer)
    writeBlendItemRecord(
      floats,
      ints,
      0,
      {
        surface,
        matrix: new G.Matrix4(),
        flags: 1,
        count: 3,
        sourceGeometry: new G.Geometry(),
        orderKey: 0,
        orderRank: 0,
      },
      { mapLayer: new Map(), dataLayer: new Map([[surface.roughnessMap!, 1]]) },
    )
    assert.equal(floats[39], model)
    assert.equal(ints[32], 1, 'accepted roughness map reaches the shader')
    assert.equal(floats[28], family === 'standard' ? surface.roughness : 1)
  }
})
