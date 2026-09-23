import test from 'node:test';
import assert from 'node:assert/strict';
import { worldDiagnostic } from './worldHandles.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { EngineError } from '../../../../sdk-core/src/index.ts';

/** A session that records the modes put on it and refuses the ones in `refused`. */
function session(refused: string[] = []) {
  const put: string[] = [];
  const opened = {
    diagnostics: { beauty: {}, wireframe: {}, clusters: {} },
    setDiagnostic(mode: string) {
      if (refused.includes(mode)) throw new Error(`${mode} unavailable`);
      put.push(mode);
    },
  };
  return { opened: opened as unknown as MeasuredWorld, put };
}

test('an unknown mode is said once on the console, naming the modes, and ignored', (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const { handle } = worldDiagnostic(() => null);
  handle.mode = 'clusters';
  handle.mode = undefined as never;
  handle.mode = undefined as never;
  handle.mode = 'finished';
  assert.equal(handle.mode, 'clusters');
  assert.equal(warned.mock.callCount(), 2);
  assert.match(String(warned.mock.calls[0].arguments[0]), /unknown mode undefined; one of beauty,/);
  assert.match(String(warned.mock.calls[1].arguments[0]), /"finished".*triangles/);
});

test('a mode written before the session opens is put on it; one it refuses leaves beauty', (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  const early = worldDiagnostic(() => null);
  early.handle.mode = 'triangles';
  const { opened, put } = session();
  early.apply(opened);
  assert.deepEqual(put, ['wireframe']);
  // Refused at the opening: the opening goes on, in the normal image, and says why.
  const refusing = worldDiagnostic(() => null);
  refusing.handle.mode = 'clusters';
  assert.doesNotThrow(() => refusing.apply(session(['clusters']).opened));
  assert.equal(refusing.handle.mode, 'beauty');
  assert.equal(warned.mock.callCount(), 1);
  // Refused by the open session: the mode in place is kept.
  const live = session(['clusters']);
  const open = worldDiagnostic(() => live.opened);
  open.handle.mode = 'triangles';
  open.handle.mode = 'clusters';
  assert.equal(open.handle.mode, 'triangles');
  assert.deepEqual(live.put, ['wireframe']);
});

test('a session that fails to open is named on the handle until one opens', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const diagnostic = worldDiagnostic(() => null);
  assert.equal(diagnostic.handle.error, null);
  diagnostic.failed(new Error('WEBGPU_LOST'));
  assert.equal(diagnostic.handle.error?.code, 'WEBGPU_LOST');
  assert.equal(logged.mock.callCount(), 1);
  diagnostic.failed(new TypeError('x is undefined'));
  assert.equal(diagnostic.handle.error?.code, 'SESSION_OPEN_FAILED');
  assert.equal(diagnostic.handle.error?.details.cause, 'x is undefined');
  const named = new EngineError('PAGE_BUDGET', 'too many pages');
  diagnostic.failed(named);
  assert.equal(diagnostic.handle.error, named);
  diagnostic.apply(session().opened);
  assert.equal(diagnostic.handle.error, null);
});
