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

test('aucune variante demandée : rien à vérifier, rien à monter', () => {
  assert.equal(resolveDiagnosticGpuVariant(undefined, 'summary'), undefined);
  assert.deepEqual(blendVariantPipeline(undefined), { entryPoint: 'fs', writeMask: 0xf });
  assert.equal(countsBlendOverdraw(undefined), false);
  assert.equal(composesOffscreen(undefined), false);
});

test('une variante est refusée hors du détail « trace »', () => {
  for (const detail of ['summary', undefined] as const)
    assert.throws(
      () => resolveDiagnosticGpuVariant('transparents-plat', detail),
      /DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE/,
    );
  assert.equal(resolveDiagnosticGpuVariant('transparents-plat', 'trace'), 'transparents-plat');
});

test('un nom inconnu est refusé, même sous « trace »', () => {
  assert.throws(
    () => resolveDiagnosticGpuVariant('transparents-rapides', 'trace'),
    /DIAGNOSTIC_GPU_VARIANT_UNKNOWN/,
  );
});

test('chaque variante neutralise un seul facteur, et son étage existe dans le module', () => {
  const attendu: Partial<Record<DiagnosticGpuVariant, { entryPoint: string; writeMask: number }>> =
    {
      'transparents-plat': { entryPoint: 'fsPlat', writeMask: 0xf },
      'transparents-sommets': { entryPoint: 'fsJete', writeMask: 0xf },
      'transparents-sans-couleur': { entryPoint: 'fs', writeMask: 0 },
      'transparents-surdessin': { entryPoint: 'fsPlat', writeMask: 0 },
    };
  // Toute autre variante — présentation, coupe, géométrie — laisse au mélange son étage de production.
  const production = { entryPoint: 'fs', writeMask: 0xf };
  for (const variant of DIAGNOSTIC_GPU_VARIANTS) {
    const pipeline = blendVariantPipeline(variant);
    assert.deepEqual(pipeline, attendu[variant] ?? production, variant);
    if (pipeline.entryPoint !== 'fs')
      assert.match(DIAGNOSTIC_BLEND_WGSL, new RegExp(`@fragment fn ${pipeline.entryPoint}\\(`));
  }
});

test('le comptage, la présentation hors écran et le raster de calcul ne sont allumés que par leur variante', () => {
  const comptant = DIAGNOSTIC_GPU_VARIANTS.filter(countsBlendOverdraw);
  const horsEcran = DIAGNOSTIC_GPU_VARIANTS.filter(composesOffscreen);
  const calcul = DIAGNOSTIC_GPU_VARIANTS.filter(requestsComputeRaster);
  assert.deepEqual(comptant, ['transparents-surdessin']);
  assert.deepEqual(horsEcran, ['presentation-hors-ecran']);
  assert.deepEqual(calcul, ['raster-calcul']);
  assert.equal(requestsComputeRaster(undefined), false);
});

test('seules les deux variantes de la coupe la réencodent, et chacune sa part', () => {
  assert.equal(selectionRepeat(undefined), null);
  assert.equal(selectionRepeat('transparents-plat'), null);
  assert.equal(selectionRepeat('selection-doublee'), 'tout');
  assert.equal(selectionRepeat('selection-tete-doublee'), 'tete');
});
