// Each pixel walks its cell's list, a few lights above those that reach it — never one that
// reaches it missed —, and the grid pass reads no depth: its tests follow its columns and lights.
import test from 'node:test'
import assert from 'node:assert/strict'
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts'
import {
  LIGHTING_RATES,
  RESOLVE_GBUFFER,
  countGrid,
  gbufferAccesses,
  lightingModel,
} from './lightGridCount.ts'
import { contractSurfaceBody } from '../../../packages/sdk-browser/src/lighting/deferred/surfaceWgsl.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../../packages/sdk-browser/src/scene/surfaceEmission.ts'

test('the cell lists hold every light that reaches a pixel, and few more', () => {
  const { eye, yaw, pitch } = ATRIUM_POSES[1]
  const view = camera(eye, yaw, pitch, 60, 864, 558)
  const lights = atriumLamps(200, 4)
  const { listed, reach, missed, work } = countGrid(view, atriumDepth(view), lights)
  assert.equal(missed, 0)
  assert.ok(reach > 0 && listed >= reach, `${listed} listed, ${reach} reaching`)
  assert.ok(listed < 1.6 * reach, `${listed / reach} listed per reaching`)
  assert.equal(work.columnTests, work.columns * lights.length, 'each light once a column')
  assert.ok(work.solves < work.columnTests / 4, `${work.solves} runs solved`)
})

test('the model prices the pass by its tests and entries, the resolve by its lights and G-buffer texels', () => {
  const work = { columns: 1, cells: 256, columnTests: 1e6, solves: 1e5, entries: 1e6 }
  const r = LIGHTING_RATES
  const count = { covered: 1e6, listed: 9e6, reach: 7e6, missed: 0, work }
  const m = lightingModel(count)
  const pass = (1.2e6 * r.pairNs * 1e3 + 2 * (1e6 + 256) * r.texelPs) / 1e9
  assert.ok(Math.abs(m.tilePass - pass) < 1e-12)
  assert.ok(Math.abs(m.lightWork - (7e6 * r.inRangePs + 2e6 * r.outOfRangePs) / 1e9) < 1e-12)
  assert.ok(Math.abs(m.gbuffer - (1e6 * 5 * r.texelPs) / 1e9) < 1e-12, 'five texels a pixel')
  assert.ok(Math.abs(lightingModel(count, 'before').gbuffer - (1e6 * 6 * r.texelPs) / 1e9) < 1e-12)
  assert.ok(Math.abs(m.lighting - m.tilePass - m.lightWork - m.gbuffer) < 1e-12)
  assert.ok(Math.abs(r.pairNs - 0.2) < 1e-3, "develop's 1.21 ms over its 6.048 million pairs")
})

test("the model's G-buffer accesses are the resolve's: the emission's texel under its bit alone", () => {
  const body = contractSurfaceBody('')
  for (const target of Object.keys(RESOLVE_GBUFFER.after).filter((t) => t !== 'colour'))
    assert.equal(
      body.match(new RegExp(`textureLoad\\(${target},coord,0\\)`, 'g'))?.length,
      1,
      target,
    )
  assert.doesNotMatch(body.replace(SURFACE_EMISSIVE_AO_WGSL, ''), /textureLoad\(emissiveAo/)
  assert.deepEqual(gbufferAccesses(RESOLVE_GBUFFER.before), { texels: 6, bytes: 37 })
  assert.deepEqual(gbufferAccesses(RESOLVE_GBUFFER.after), { texels: 5, bytes: 29 })
})
