import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitViewPages } from './worldSession.ts';
import type { MeasuredWorld } from '../session/explorer.ts';

test('world.awaitPages waits for the scene, then for pages alone, never an image, heard (#408)', async () => {
  const steps: unknown[] = [];
  const session = {
    awaitPages: async (options?: { image?: boolean }) => void steps.push(options),
  } as unknown as MeasuredWorld;
  const runtime = { settled: async () => void steps.push('settled') };
  const onProgress = () => {};
  await awaitViewPages(runtime, () => session, onProgress);
  assert.deepEqual(steps, ['settled', { image: false, onProgress }]);
});
