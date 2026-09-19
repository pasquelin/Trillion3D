import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blendVariantPipeline,
  composesOffscreen,
  countsBlendOverdraw,
  DIAGNOSTIC_BLEND_WGSL,
  DIAGNOSTIC_GPU_VARIANTS,
  resolveDiagnosticGpuVariant,
  selectionRepeat,
} from './diagnosticGpuVariant.ts';
import type { DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { requestsComputeRaster } from './diagnosticGpuGeometry.ts';

test('no variant requested: nothing to check, nothing to mount', () => {
  assert.equal(resolveDiagnosticGpuVariant(undefined, 'summary'), undefined);
  assert.deepEqual(blendVariantPipeline(undefined), { entryPoint: 'fs', writeMask: 0xf });
  assert.equal(countsBlendOverdraw(undefined), false);
  assert.equal(composesOffscreen(undefined), false);
});

test('a variant is refused outside the "trace" detail', () => {
  for (const detail of ['summary', undefined] as const)
    assert.throws(
      () => resolveDiagnosticGpuVariant('transparents-plat', detail),
      /DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE/,
    );
  assert.equal(resolveDiagnosticGpuVariant('transparents-plat', 'trace'), 'transparents-plat');
});

test('an unknown name is refused, even under "trace"', () => {
  assert.throws(
    () => resolveDiagnosticGpuVariant('transparents-rapides', 'trace'),
    /DIAGNOSTIC_GPU_VARIANT_UNKNOWN/,
  );
});

test('each variant neutralises a single factor, and its stage exists in the module', () => {
  const attendu: Partial<Record<DiagnosticGpuVariant, { entryPoint: string; writeMask: number }>> =
    {
      'transparents-plat': { entryPoint: 'fsPlat', writeMask: 0xf },
      'transparents-sommets': { entryPoint: 'fsJete', writeMask: 0xf },
      'transparents-sans-couleur': { entryPoint: 'fs', writeMask: 0 },
      'transparents-surdessin': { entryPoint: 'fsPlat', writeMask: 0 },
    };
  // Any other variant — presentation, cut, geometry — leaves blend its production stage.
  const production = { entryPoint: 'fs', writeMask: 0xf };
  for (const variant of DIAGNOSTIC_GPU_VARIANTS) {
    const pipeline = blendVariantPipeline(variant);
    assert.deepEqual(pipeline, attendu[variant] ?? production, variant);
    if (pipeline.entryPoint !== 'fs')
      assert.match(DIAGNOSTIC_BLEND_WGSL, new RegExp(`@fragment fn ${pipeline.entryPoint}\\(`));
  }
});

test('counting, off-screen presentation and the compute raster are turned on only by their variant', () => {
  const comptant = DIAGNOSTIC_GPU_VARIANTS.filter(countsBlendOverdraw);
  const horsEcran = DIAGNOSTIC_GPU_VARIANTS.filter(composesOffscreen);
  const calcul = DIAGNOSTIC_GPU_VARIANTS.filter(requestsComputeRaster);
  assert.deepEqual(comptant, ['transparents-surdessin']);
  assert.deepEqual(horsEcran, ['presentation-hors-ecran']);
  assert.deepEqual(calcul, ['raster-calcul', 'raster-hybride']);
  assert.equal(requestsComputeRaster(undefined), false);
});

test('only the two cut variants re-encode it, and each its share', () => {
  assert.equal(selectionRepeat(undefined), null);
  assert.equal(selectionRepeat('transparents-plat'), null);
  assert.equal(selectionRepeat('selection-doublee'), 'tout');
  assert.equal(selectionRepeat('selection-tete-doublee'), 'tete');
});
