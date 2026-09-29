// Diagnostics that cost nothing when nobody listens (`lazyDiagnostic`): the page streamer and the
// GPU page reader emit through it, `emit?.(…)`, at every request, transfer and eviction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lazyDiagnostic } from './engineDiagnostic.ts';
import type { BackendDiagnostic } from '../backend/types.ts';
import { createPageStreamer } from '../streaming/pageStreamer.ts';
import { servedPages } from '../streaming/servedPages.fixture.ts';

test('with no listener there is no emitter: a call builds neither its detail nor its closure', () => {
  const emit = lazyDiagnostic(undefined);
  let made = 0;
  /** Stands for the closure a call site writes: counts each time one is made. */
  const closure = () => {
    made++;
    return () => ({ made });
  };
  // The argument list is not evaluated: no closure is made.
  emit?.('phase', 'message', closure());
  assert.equal(made, 0);
  assert.equal(emit, undefined);
});

test('with a listener each event builds its detail once, and a throwing listener is its own', () => {
  const heard: BackendDiagnostic[] = [];
  let built = 0;
  const emit = lazyDiagnostic((diagnostic) => {
    heard.push(diagnostic);
    throw new Error('observer');
  });
  emit?.('phase', 'message', () => ({ built: ++built }));
  assert.equal(built, 1);
  assert.deepEqual(heard, [{ phase: 'phase', message: 'message', context: { built: 1 } }]);
});

test('a streamer with no listener reads, hits and evicts; one with a listener hears each step', async () => {
  const urls = ['a.bin', 'b.bin'];
  const { pages } = await servedPages(urls);
  const phases: string[] = [];
  for (const onDiagnostic of [undefined, (d: BackendDiagnostic) => void phases.push(d.phase)]) {
    const streamer = createPageStreamer(pages, 'http://diag/', { maxPages: 1, onDiagnostic });
    // One read after the other: `b` lands last, so it is the one kept and read again as a hit.
    await streamer.request(['a.bin']);
    await streamer.request(['b.bin']);
    await streamer.request(['b.bin']);
    assert.equal(streamer.stats().evictions, 1);
    streamer.dispose();
  }
  for (const phase of ['page-request', 'page-cache-miss', 'page-cache-hit', 'page-cache-eviction'])
    assert.ok(phases.includes(phase), phase);
});
