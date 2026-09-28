import test from 'node:test';
import assert from 'node:assert/strict';
import { gazeNetworkCounter } from './gazeNetworkCounter.ts';
import { gazeNetworkLines } from './gazeNetworkRun.ts';

test('counts encoded texture and other transfer while cache hits contribute no bytes', () => {
  const counter = gazeNetworkCounter();
  counter.request('texture', 'http://host/cache/textures/v6/a/linear-1.bc7');
  counter.finish('texture', 145);
  counter.request('manifest', 'http://host/cache/native/full/manifest.json');
  counter.finish('manifest', 75);
  counter.request('cached', 'http://host/cache/textures/v6/a/linear-2.bc7');
  counter.cache('cached');
  counter.finish('cached', 80);
  assert.deepEqual(counter.reading(), {
    textureBytes: 145,
    otherBytes: 75,
    textureRequests: 2,
    failedRequests: 0,
    unfinishedRequests: 0,
    unmeasuredRedirects: 0,
  });
});

test('redirect bytes retain their source and missing transfer makes the reading incomplete', () => {
  const counter = gazeNetworkCounter();
  counter.request('one', 'http://host/cache/textures/redirect');
  counter.request('one', 'http://host/cache/textures/final', 25);
  counter.finish('one', 100);
  counter.request('two', 'http://host/cache/textures/unknown');
  counter.request('two', 'http://host/cache/textures/final');
  counter.fail('two');
  counter.request('three', 'http://host/cache/textures/pending');
  assert.deepEqual(counter.reading(), {
    textureBytes: 125,
    otherBytes: 0,
    textureRequests: 1,
    failedRequests: 1,
    unfinishedRequests: 1,
    unmeasuredRedirects: 1,
  });
});

test('the summary marks failed or unfinished transfer as incomplete', () => {
  const counter = gazeNetworkCounter();
  counter.request('failed', 'http://host/cache/textures/fail.bc7');
  counter.fail('failed');
  const row = {
    view: 'general',
    pixelError: 1,
    side: 'after',
    ...counter.reading(),
  };
  assert.match(gazeNetworkLines([row], 60).join('\n'), /\| 1 \| 0 \| 0 \| incomplete \|/);
});
