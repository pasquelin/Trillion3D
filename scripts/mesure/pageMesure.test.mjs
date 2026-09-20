// The engine publishes its CPU bounds (`cpu-timing`) on its own cadence, in the page: the
// collector keeps every report with the measured frame it came on, so the reading can tell
// a report of the warm-up from one of the measured loop, and never mixes them into one median.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collecteDiagnostics } from './pageMesure.mjs';

test('cpu-timing reports are kept in order, stamped with the measured frame, other phases apart', () => {
  const lost = [];
  const diagnostics = collecteDiagnostics(lost);
  const steps = { worldMs: { p50: 0.1, p95: 0.2, max: 0.3 } };
  const sample = { frame: 9, totalMs: 4, lightsMs: 0, selectionMs: 1 };
  const echantillon = { image: 9, totalMs: 4, lightsMs: 0, selectionMs: 1 };
  diagnostics.onDiagnostic({
    phase: 'cpu-timing',
    context: { ...sample, steps: { frames: 40, steps } },
  });
  diagnostics.image = 17;
  diagnostics.onDiagnostic({ phase: 'cpu-timing', context: { ...sample, steps: null } });
  diagnostics.onDiagnostic({ phase: 'dag-warnings', context: { count: 1 } });
  assert.deepEqual(diagnostics.bornesCpu, [
    { image: null, echantillon, images: 40, etapes: steps },
    { image: 17, echantillon, images: null, etapes: null },
  ]);
  assert.deepEqual(diagnostics.avertissements, { count: 1 });
  assert.deepEqual(lost, []);
});
