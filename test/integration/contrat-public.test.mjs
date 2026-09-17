import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT_VERSION, SDK_VERSION, assertFormat } from '@web-geometry/sdk/core';
import { prepare } from '@web-geometry/sdk/node';
import { createExplorer, createGpuPageCache, webgpuPagesBackend } from '@web-geometry/sdk/browser';
test('Built public ESM exports work without DOM initialization', () => {
  assert.equal(SDK_VERSION, '0.1.0');
  assertFormat(FORMAT_VERSION);
  assert.equal(typeof prepare, 'function');
  assert.equal(typeof createExplorer, 'function');
  assert.equal(typeof createGpuPageCache, 'function');
  assert.equal(typeof webgpuPagesBackend, 'function');
});
