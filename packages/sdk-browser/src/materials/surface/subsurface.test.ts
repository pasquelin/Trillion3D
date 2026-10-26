import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { createSurfaceBuffer } from './surfaceAllocation.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { directLightingWgsl } from '../../lighting/direct/lightLoop.fixture.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { hostSurface, repaintHostSurface } from '../../session/world/materials/surface.ts'
import { surfaceRow } from '../../geometry/rows/surfaceRow.ts'
import { SURFACE_WORD_LAYERS, SURFACE_WORDS_FORMAT } from './surfaceOutputs.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wantsSubsurface } from './subsurface.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import { createResidentSurfaces } from '../../geometry/clusters/surfaces.ts'

const DIRECT_LIGHTING_WGSL = wgslModule(directLightingWgsl())

test('thin transmission stays independent of albedo, disabled by default and on single sides', () => {
  assert.deepEqual(G.standardSurface().subsurfaceColor, [0, 0, 0])
  const sheet = { side: 'double', subsurfaceColor: new Color().setRGB(0.2, 0.7, 0.1) }
  assert.deepEqual(G.standardSurface(sheet).subsurfaceColor, [0.2, 0.7, 0.1])
  const red = G.standardSurface({ ...sheet, color: new Color().setRGB(1, 0, 0) })
  assert.deepEqual(red.subsurfaceColor, [0.2, 0.7, 0.1])
  const front = G.standardSurface({ ...sheet, side: 'front' })
  assert.deepEqual(front.subsurfaceColor, [0, 0, 0])
})

test('a transmission map enters the existing color atlas and keeps its own slot', () => {
  const image = G.dataTexture(new Uint8Array([20, 100, 40, 255]), 1, 1)
  const surface = G.standardSurface({ side: 'double', subsurfaceMap: image })
  assert.ok(surface.subsurfaceMap)
  const row = surfaceRow(surface, {
    mapLayer: new Map([[surface.subsurfaceMap, 7]]),
    dataLayer: new Map(),
  })
  assert.equal(row.subsurface, 7)
  assert.equal(row.map, 0, 'transmission does not replace the base map')
})

test('enabled transmission allocates exactly eight bytes per pixel, without another MRT', () => {
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const disabled = createSurfaceBuffer(gpu.device, 13, 7)
  const enabled = createSurfaceBuffer(gpu.device, 13, 7, { subsurface: true })
  assert.equal(enabled.allocationBytes - disabled.allocationBytes, (13 * 7 - 1) * 8)
  assert.equal(enabled.views().length, 4)
  // The transmission is one more layer of the colours, the frame's size.
  assert.equal(enabled.hasSubsurface, true)
  assert.equal(enabled.colours.depthOrArrayLayers, disabled.colours.depthOrArrayLayers + 1)
  assert.equal(enabled.colours.width * enabled.colours.height, 13 * 7)
  // The words are the same with or without transmission: the flags' layer.
  for (const { words } of [disabled, enabled]) {
    assert.equal(words.format, SURFACE_WORDS_FORMAT)
    assert.equal(words.depthOrArrayLayers, SURFACE_WORD_LAYERS)
  }
  disabled.dispose()
  enabled.dispose()
  // The colours, the words and the lobes' 1×1 each, the disabled transmission's 1×1 beside.
  assert.equal(gpu.destroyed.length, 7)
})

test('shipped thin transmission is a wrapped cosine times a broad lobe against the light', () => {
  // The share of a light's energy a thin sheet gives the eye (`thinTransmission`, `declaredLight`): its
  // subsurface colour weighs it per channel, and it has no 1/π and no cosine of its own.
  const { thinTransmission } = shaderRun<{
    thinTransmission: (n: number[], v: number[], l: number[]) => number
  }>(DIRECT_LIGHTING_WGSL, ['thinTransmission'], {})
  // The program computes in single precision (its constants are rounded to 24 bits: a relative
  // 1.6e-8 against the double-precision formula), so the formulas are held to a relative 1e-6.
  const near = (actual: number, expected: number) =>
    assert.ok(
      Math.abs(actual - expected) <= 1e-6 * Math.abs(expected),
      `${actual} against ${expected}`,
    )
  const N = [0, 0, 1]
  // A light straight behind and the eye on its line: the wrap's 2/3 on the lobe's top, 1 / (π · 0.36).
  const peak = 2 / 3 / (Math.PI * 0.36)
  near(thinTransmission(N, N, [0, 0, -1]), peak)
  // Past the horizon the sheet still takes the light, down to nothing at a cosine of one half in front.
  const horizon = thinTransmission(N, N, [1, 0, 0])
  near(horizon, (0.5 / 2.25) * (0.36 / Math.PI))
  assert.equal(thinTransmission(N, N, [Math.sqrt(0.75), 0, 0.5]), 0)
  assert.equal(thinTransmission(N, N, N), 0)
  // The eye on the light's own side sees the lobe's foot, against it its top.
  const back: number[] = [0, 0, -1]
  near(thinTransmission(N, back, back), (2 / 3) * (0.36 / Math.PI))
  assert.ok(thinTransmission(N, N, back) > 7 * thinTransmission(N, back, back))
})

test('public material reaches the engine, and a color edit repaints without an API rebuild', () => {
  const map = new Texture({ width: 1, height: 1 })
  const paint = material.meshStandard({
    side: 'double',
    subsurfaceColor: 0x00ff00,
    subsurfaceMap: map,
  })
  const surface = hostSurface(paint)
  assert.deepEqual(surface.subsurfaceColor, [0, 1, 0])
  assert.ok(surface.subsurfaceMap)
  const version = paint.version
  paint.subsurfaceColor.set(0xff0000)
  assert.ok(paint.version > version)
  repaintHostSurface(surface, paint, 'faces')
  const repainted = surface
  assert.deepEqual(repainted.subsurfaceColor, [1, 0, 0])
  const layers = { mapLayer: new Map([[repainted.subsurfaceMap!, 3]]), dataLayer: new Map() }
  assert.equal(surfaceRow(repainted, layers).subsurface, 3, 'its own atlas slot')
})

test('the thin transmission target asks still clusters their sheets once, again once they move', () => {
  let reads = 0
  const sheet = {
    get subsurfaceColor() {
      reads++
      return [0.2, 0.7, 0.1]
    },
  }
  const surfaces = createResidentSurfaces()
  surfaces.set(0, sheet as PageSurface)
  surfaces.set(1, sheet as PageSurface)
  const rt = { layout: { clusters: { surfaces, infoEpoch: 0 } } } as unknown as WebgpuPagesRuntime
  for (let frame = 0; frame < 4; frame++) assert.equal(wantsSubsurface(rt), true)
  assert.equal(reads, 1, 'one read of the one surface over four frames')
  surfaces.clear()
  assert.equal(wantsSubsurface(rt), false)
})
