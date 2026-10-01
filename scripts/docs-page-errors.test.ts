import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Page } from 'playwright';
import { collectPageErrors } from './docs/examples/capture.ts';

test('portal and examples hear runtime errors and distinguish failing resources by URL', () => {
  const page = new EventEmitter();
  const errors: string[] = [];
  collectPageErrors(page as unknown as Page, (error) => errors.push(error));
  const message = (type: string, text: string, url = '') => ({
    type: () => type,
    text: () => text,
    location: () => ({ url }),
  });
  page.emit('pageerror', new Error('Session failed'));
  page.emit('console', message('error', 'shader rejected'));
  for (const url of ['/first.bin', '/second.bin'])
    page.emit('console', message('error', 'Failed to load resource: 404', url));
  page.emit('console', message('info', 'ordinary information'));
  page.emit('console', message('info', '[trillion3d] first render configuration'));
  page.emit('console', message('info', 'unlabelled engine output', '/runtime/engine.js?build=1'));
  page.emit('response', { status: () => 404, url: () => '/intentional-probe' });
  assert.deepEqual(errors, [
    'Session failed',
    'shader rejected',
    'Failed to load resource: 404 /first.bin',
    'Failed to load resource: 404 /second.bin',
    'Engine console.info: [trillion3d] first render configuration',
    'Engine console.info: unlabelled engine output',
  ]);
});
