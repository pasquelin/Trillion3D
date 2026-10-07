import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blendVariantPipeline,
  composesOffscreen,
  countsBlendOverdraw,
  DIAGNOSTIC_BLEND_WGSL,
  resolveDiagnosticGpuVariant,
  selectionRepeat,
} from './gpuVariant.ts'
import type { DiagnosticGpuVariant } from './gpuVariant.ts'
import { requestsComputeRaster } from './gpuGeometry.ts'
import { DIAGNOSTIC_GPU_VARIANTS } from './gpuVariants.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('no variant requested: nothing to check, nothing to mount', () => {
  assert.equal(resolveDiagnosticGpuVariant(undefined, 'summary'), undefined)
  assert.deepEqual(blendVariantPipeline(undefined), { entryPoint: 'fs', writeMask: 0xf })
  assert.equal(countsBlendOverdraw(undefined), false)
  assert.equal(composesOffscreen(undefined), false)
})

test('a variant is refused outside the "trace" detail', () => {
  for (const detail of ['summary', undefined] as const)
    assert.throws(
      () => resolveDiagnosticGpuVariant('blend-flat', detail),
      /DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE/,
    )
  assert.equal(resolveDiagnosticGpuVariant('blend-flat', 'trace'), 'blend-flat')
})

test('an unknown name is refused, even under "trace"', () => {
  assert.throws(
    () => resolveDiagnosticGpuVariant('transparents-rapides', 'trace'),
    /DIAGNOSTIC_GPU_VARIANT_UNKNOWN/,
  )
})

test('each variant neutralises a single factor, and its stage exists in the module', () => {
  const expected: Partial<Record<DiagnosticGpuVariant, { entryPoint: string; writeMask: number }>> =
    {
      'blend-flat': { entryPoint: 'fsPlat', writeMask: 0xf },
      'blend-vertices': { entryPoint: 'fsJete', writeMask: 0xf },
      'blend-no-colour': { entryPoint: 'fs', writeMask: 0 },
      'blend-overdraw': { entryPoint: 'fsPlat', writeMask: 0 },
    }
  // Any other variant — presentation, cut, geometry — leaves blend its production stage.
  const production = { entryPoint: 'fs', writeMask: 0xf }
  for (const variant of DIAGNOSTIC_GPU_VARIANTS) {
    const pipeline = blendVariantPipeline(variant)
    assert.deepEqual(pipeline, expected[variant] ?? production, variant)
    if (pipeline.entryPoint !== 'fs')
      assert.match(
        wgslSource(DIAGNOSTIC_BLEND_WGSL),
        new RegExp(`@fragment fn ${pipeline.entryPoint}\\(`),
      )
  }
})

test('counting, off-screen presentation and the compute raster are turned on only by their variant', () => {
  const comptant = DIAGNOSTIC_GPU_VARIANTS.filter(countsBlendOverdraw)
  const offscreen = DIAGNOSTIC_GPU_VARIANTS.filter(composesOffscreen)
  const compute = DIAGNOSTIC_GPU_VARIANTS.filter(requestsComputeRaster)
  assert.deepEqual(comptant, ['blend-overdraw'])
  assert.deepEqual(offscreen, ['present-offscreen'])
  assert.deepEqual(compute, ['raster-compute', 'raster-hybrid'])
  assert.equal(requestsComputeRaster(undefined), false)
})

test('only the two cut variants re-encode it, and each its share', () => {
  assert.equal(selectionRepeat(undefined), null)
  assert.equal(selectionRepeat('blend-flat'), null)
  assert.equal(selectionRepeat('selection-doubled'), 'all')
  assert.equal(selectionRepeat('selection-head-doubled'), 'head')
})
