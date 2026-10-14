import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import { rowMaterial } from '../webgpu/row/pageRowMaterial.ts'
import { writeMaterialRecord } from '../webgpu/material/materialRecord.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../webgpu/material/materialLayout.ts'
import { FOG_FREE_MODEL_BIT } from '../scene/surfaceModel.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import { prepared, device } from '../webgpu/water/pass.fixture.ts'
import { writeVolumeRecords } from '../webgpu/transparent/transmission.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import {
  BLEND_SHADER,
  DIRECT_LIGHTING_SHADER,
  WATER_COMPOSITE_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts'
import { surfaceWritten } from '../page/surfaceWrites.ts'

test('a fog-free material reaches both the opaque flag and transparent shader', () => {
  const material = G.familySurface('standard', { fog: false })
  const surface = surfaceOf(material)
  assert.equal(surface.fog, false)
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const row = rowMaterial(surface, undefined, layers)
  assert.equal(row.flags & (1 << 20), 1 << 20)
  assert.match(SHADE_SHADER, /page.flags&1048576u/)
  assert.match(DIRECT_LIGHTING_SHADER, /surfaceFlag&128u/)

  // The transparent pass reads it off the surface's record, above its model.
  const record = new Uint32Array(MATERIAL_RECORD_WORDS)
  writeMaterialRecord(record, 0, surface, layers, 0)
  assert.equal(record[MATERIAL_RECORD.at.model] & FOG_FREE_MODEL_BIT, FOG_FREE_MODEL_BIT)
  assert.match(BLEND_SHADER, /flags&1048576u/)
  material.fog = true
  surfaceWritten(material)
  assert.equal(surfaceOf(material).fog, true, 'a declared material change is heard')
  assert.equal(rowMaterial(surface, undefined, layers).flags & (1 << 20), 0)
})

test('a fog-free transmissive material reaches the water composite without changing opacity', () => {
  const { blendState, gpu } = prepared()
  const item = blendState.blendGpu.find((entry) => entry.transmissive)
  assert.ok(item)
  item.surface.fog = false
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime
  writeVolumeRecords(rt, device)
  assert.equal(blendState.volumePacked[7], 1)
  assert.match(WATER_COMPOSITE_SHADER, /volumeMarked\(vol,1u\)\),a\);/)
  item.surface.fog = true
  writeVolumeRecords(rt, device)
  assert.equal(blendState.volumePacked[7], 0)
})
