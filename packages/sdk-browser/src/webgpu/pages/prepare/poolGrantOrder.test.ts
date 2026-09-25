// The prepare grant of the geometry pool (`cache.ts`) is answered asynchronously: what reads the
// pool, and what sets it meanwhile, must see the pool the device granted, never the one asked.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { coarseQuadScene } from '../testOccluder.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import { refusing } from './refusing.fixture.ts';

/** The coarse quad — one root page over two leaves, a pool of three slots at most and one at its
 *  floor — on a device that runs `during` when the geometry pool's first buffer is made, inside
 *  the grant's out-of-memory scope; disposed once `t` ends. */
function granting(
  t: TestContext,
  during: (raise: (message: string) => void) => void,
  after: (raise: (message: string) => void) => void = () => {},
) {
  installGpuGlobals();
  let first = true;
  const gpu = refusing('createBuffer', 'geometry page cache', (raise) => {
    (first ? during : after)(raise);
    first = false;
  });
  const events: BackendDiagnostic[] = [];
  const fixture = coarseQuadScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    viewport: [32, 32],
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
  });
  t.after(() => {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  });
  return { backend, events };
}

test('the cover bootstrap reports the slots of the pool the device granted', async (t) => {
  const { backend, events } = granting(t, (raise) => raise('Out of memory'));
  await backend.prepare();
  const granted = backend.metrics().geometryPoolSlots;
  assert.equal(granted, 1, 'the pool of three slots was refused and drawn at its floor');
  const said = events.filter((event) => event.phase.startsWith('coverage-bootstrap'));
  assert.ok(said.length > 0);
  for (const { phase, context } of said) assert.equal(context.slots, granted, phase);
});

test('a geometry budget set while the prepare grant is answered is the one the pool ends with', async (t) => {
  // One slot's bytes: the pool at its floor.
  const later = 24;
  let set: Promise<unknown> | undefined;
  const { backend } = granting(
    t,
    () => (set = backend.setMemoryBudgets!({ geometryPoolBytes: later })),
  );
  await backend.prepare();
  await set;
  const { geometryPoolBytes, geometryPoolSlots } = backend.metrics();
  assert.equal(geometryPoolBytes, later, 'the later call wins');
  assert.equal(geometryPoolSlots, 1);
});

test('a later budget the device refuses even at its floor keeps the pool it granted', async (t) => {
  let set: Promise<unknown> | undefined;
  const { backend } = granting(
    t,
    () => (set = backend.setMemoryBudgets!({ geometryPoolBytes: 48 })),
    (raise) => raise('Out of memory'),
  );
  await backend.prepare();
  await set;
  assert.equal(backend.metrics().geometryPoolSlots, 3, 'the pool first granted stays');
});
