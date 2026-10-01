import assert from 'node:assert/strict';
import test from 'node:test';
import { EngineError } from '../../../packages/sdk/browser.ts';
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
  for (const url of [
    '../assets/examples/hall/cache/native/full/manifest.json',
    '../assets/examples/terrain-tiles/cache-none/native/full/manifest.json',
  ])
    assert.equal(failureText(refused(url, 404)), hint, url);
  for (const other of [
    refused('../assets/examples/hall/cache/native/full/manifest.json', 500),
    refused('../assets/examples/hall/cache/native/full/pages/0.bin', 404),
    refused('/models/hall.glb', 404),
    new Error('the model did not load'),
  ])
    assert.equal(failureText(other), other.message);
});
