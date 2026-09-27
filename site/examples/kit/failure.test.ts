import assert from 'node:assert/strict';
import test from 'node:test';
import { EngineError } from '../../../packages/sdk-core/src/contracts/cache.ts';
import { failureText, isPassing } from './failure.ts';

test('a video refused or cut short in passing does not open the error card', () => {
  assert.equal(isPassing(new DOMException('interrupted by pause()', 'AbortError')), true);
  assert.equal(isPassing(new DOMException('no gesture yet', 'NotAllowedError')), true);
  assert.equal(isPassing(new DOMException('no such file', 'NotFoundError')), false);
  assert.equal(isPassing(new Error('the model did not load')), false);
});

test('a missing cooked cache names the command that builds it; any other error keeps its message', () => {
  const refused = (url: string, status: number) =>
    new EngineError('RESOURCE_HTTP_ERROR', `${url}: HTTP ${status}, type absent`, { url, status });
  const hint = 'The cooked cache is missing: run pnpm compile:caches';
  const manifest = refused('/assets/examples/hall/cache/hall/manifest.json', 404);
  assert.equal(failureText(manifest, manifest.message), hint);
  for (const other of [
    refused('/assets/examples/hall/cache/hall/manifest.json', 500),
    refused('/assets/examples/hall/cache/hall/pages/0.bin', 404),
    refused('/models/hall.glb', 404),
    new Error('the model did not load'),
  ])
    assert.equal(failureText(other, other.message), other.message);
});
