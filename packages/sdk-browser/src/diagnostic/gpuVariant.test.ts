import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blendVariantPipeline,
  composesOffscreen,
  countsBlendOverdraw,
  resolveDiagnosticGpuVariant,
  selectionRepeat,
} from './gpuVariant.ts';

test('no variant requested: nothing to check, nothing to mount', () => {
  assert.equal(resolveDiagnosticGpuVariant(undefined, 'summary'), undefined);
  assert.deepEqual(blendVariantPipeline(undefined), { entryPoint: 'fs', writeMask: 0xf });
  assert.equal(countsBlendOverdraw(undefined), false);
  assert.equal(composesOffscreen(undefined), false);
});

test('a variant is refused outside the "trace" detail', () => {
  for (const detail of ['summary', undefined] as const)
    assert.throws(
      () => resolveDiagnosticGpuVariant('blend-flat', detail),
      /DIAGNOSTIC_GPU_VARIANT_REQUIRES_TRACE/,
    );
  assert.equal(resolveDiagnosticGpuVariant('blend-flat', 'trace'), 'blend-flat');
});

test('an unknown name is refused, even under "trace"', () => {
  assert.throws(
    () => resolveDiagnosticGpuVariant('transparents-rapides', 'trace'),
    /DIAGNOSTIC_GPU_VARIANT_UNKNOWN/,
  );
});

test('only the two cut variants re-encode it, and each its share', () => {
  assert.equal(selectionRepeat(undefined), null);
  assert.equal(selectionRepeat('blend-flat'), null);
  assert.equal(selectionRepeat('selection-doubled'), 'all');
  assert.equal(selectionRepeat('selection-head-doubled'), 'head');
});
