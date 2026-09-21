import assert from 'node:assert/strict';
import test from 'node:test';
import { handleExplorerRenderError } from './explorerRenderFallback.ts';
import type { RenderBackend } from './backendTypes.ts';

function fixture(lost: boolean) {
  const events: string[] = [];
  const drawn: string[] = [];
  const baseline = {
    id: 'baseline',
    render: () => drawn.push('render'),
  } as unknown as RenderBackend;
  const active = { id: 'active' } as RenderBackend;
  const state = { active, fallbackReason: null as string | null };
  const inputs = {
    measuring: false,
    diagnostic: 'beauty' as const,
    webglSurface: { lost },
    camera: {} as never,
    baseline,
    state,
    scope: 'scene' as never,
    emit: (event: { code: string }) => void events.push(event.code),
    diagnose: () => {},
    compose: Object.assign(() => void drawn.push('compose'), { dispose() {} }),
  };
  return { events, drawn, state, baseline, inputs };
}

test('a loss the engine surface reports is fatal and draws nothing', () => {
  const f = fixture(true);
  assert.throws(() => handleExplorerRenderError(new Error('draw'), f.inputs), /draw/);
  assert.deepEqual(f.events, ['CONTEXT_LOST']);
  assert.deepEqual(f.drawn, []);
  assert.equal(f.state.active.id, 'active');
  assert.match(f.state.fallbackReason!, /Context lost/);
});

test('a backend error on a live surface falls back to the baseline', () => {
  const f = fixture(false);
  handleExplorerRenderError(new Error('draw'), f.inputs);
  assert.deepEqual(f.events, ['BACKEND_ERROR']);
  assert.deepEqual(f.drawn, ['render', 'compose']);
  assert.equal(f.state.active, f.baseline);
});
