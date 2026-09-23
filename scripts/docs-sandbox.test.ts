import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoute, resolvePage } from '../site/app/portal/routes.ts';
import { sandboxDocument, sandboxReducer } from '../site/app/layout/useSandbox.ts';

test('the sandbox route starts from the default example or from a ready one', () => {
  const ready = ['a-first-world', 'a-neon-sign'];
  const page = (hash: string) => resolvePage(parseRoute(hash), [], ready);
  assert.deepEqual(page('#/fr/sandbox'), { kind: 'sandbox', id: '' });
  assert.deepEqual(page('#/en/sandbox/a-neon-sign'), { kind: 'sandbox', id: 'a-neon-sign' });
  assert.equal(page('#/en/sandbox/no-such-example').kind, 'not-found');
});

test('Run renders the edited source and Reset brings back the starting one', () => {
  const edited = sandboxReducer({ edited: null, ran: null }, { type: 'edit', code: '<p>' });
  assert.deepEqual(edited, { edited: '<p>', ran: null });
  const ran = sandboxReducer(edited, { type: 'run' });
  assert.deepEqual(ran, { edited: '<p>', ran: '<p>' });
  // `null` is the starting source, in the editor and in the frame.
  assert.deepEqual(sandboxReducer(ran, { type: 'reset' }), { edited: null, ran: null });
});

test('the sandbox frame resolves the example relative paths from the example file', () => {
  const address = 'https://site.test/docs/examples/a-first-world.html';
  const page = sandboxDocument(
    '<!doctype html><html><head lang="en"><title>x</title></head><body><header></header></body></html>',
    address,
  );
  assert.match(page, /^<!doctype html><html><head lang="en"><base href="[^"]+"><title>/);
  const base = /<base href="([^"]+)">/.exec(page)![1];
  assert.equal(
    new URL('../runtime/engine.js', base).href,
    'https://site.test/docs/runtime/engine.js',
  );
  assert.equal(page.match(/<base /g)!.length, 1);
  assert.match(sandboxDocument('<p>headless</p>', address), /^<base href="[^"]+"><p>/);
});
