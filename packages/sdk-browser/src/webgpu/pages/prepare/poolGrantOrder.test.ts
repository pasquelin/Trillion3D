// The prepare grants of the geometry pool (`cache.ts`) and of the texture pools (`textures.ts`)
// are answered asynchronously: what reads a pool, and what sets it meanwhile, must see the pool
// the device granted, never the one asked.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { coarseQuadScene } from '../testOccluder.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import type { MemoryBudgetsReport } from '../../../residency/pools.ts';
import { refusing } from './refusing.fixture.ts';

/** The pools a test answers: the geometry pool's buffer, or the texture pools. */
const GEOMETRY = ['createBuffer', 'geometry page cache'] as const;
const TEXTURES = ['createTexture', 'texture pool'] as const;

type Answer = (raise: (message: string) => void) => void;

/** The coarse quad — one root page over two leaves, a pool of three slots at most and one at its
 *  floor — on a device that runs `during` when the first of `pool` is made (the geometry pool's
 *  buffer by default), inside the grant's out-of-memory scope, and `after` for the next ones;
 *  disposed once `t` ends. */
function granting(
  t: TestContext,
  options: { during: Answer; after?: Answer; pool?: typeof GEOMETRY | typeof TEXTURES },
) {
  const { during, after = () => {}, pool = GEOMETRY } = options;
  installGpuGlobals();
  let first = true;
  const gpu = refusing(...pool, (raise) => {
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
  const { backend, events } = granting(t, { during: (raise) => raise('Out of memory') });
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
  const { backend } = granting(t, {
    during: () => (set = backend.setMemoryBudgets!({ geometryPoolBytes: later })),
  });
  await backend.prepare();
  await set;
  const { geometryPoolBytes, geometryPoolSlots } = backend.metrics();
  assert.equal(geometryPoolBytes, later, 'the later call wins');
  assert.equal(geometryPoolSlots, 1);
});

test('a later budget the device refuses even at its floor keeps the pool it granted', async (t) => {
  let set: Promise<unknown> | undefined;
  const { backend } = granting(t, {
    during: () => (set = backend.setMemoryBudgets!({ geometryPoolBytes: 48 })),
    after: (raise) => raise('Out of memory'),
  });
  await backend.prepare();
  await set;
  assert.equal(backend.metrics().geometryPoolSlots, 3, 'the pool first granted stays');
});

test('a later budget drawing the slots already granted allocates no second pool', async (t) => {
  let set: Promise<unknown> | undefined,
    again = 0;
  const { backend } = granting(t, {
    during: () => (set = backend.setMemoryBudgets!({ geometryPoolBytes: 1024 })),
    after: () => again++,
  });
  await backend.prepare();
  await set;
  assert.equal(backend.metrics().geometryPoolSlots, 3);
  assert.equal(again, 0, 'the pool granted first is kept');
});

test('a texture budget set while the prepare grant is answered is the one the pools end with', async (t) => {
  let set: Promise<MemoryBudgetsReport> | undefined;
  const { backend } = granting(t, {
    during: () => (set = backend.setMemoryBudgets!({ texturePoolBytes: 1 })),
    pool: TEXTURES,
  });
  await backend.prepare();
  const { texturePool } = (await set)!;
  assert.deepEqual([texturePool?.budgetBytes, texturePool?.clamp], [1, 'minimum']);
});

test('a report made during the prepare grants names the pools the device grants', async (t) => {
  // Set during the geometry grant: three slots are refused each time they are asked, the floor
  // granted; the texture pools, granted after, are named too, never `null`.
  let report: Promise<MemoryBudgetsReport> | undefined,
    made = 0;
  const { backend } = granting(t, {
    during: (raise) => {
      report = backend.setMemoryBudgets!({ geometryPoolBytes: 1024, texturePoolBytes: 1 });
      raise('Out of memory');
    },
    after: (raise) => void (++made % 2 === 0 && raise('Out of memory')),
  });
  await backend.prepare();
  const { geometryPool, texturePool } = (await report)!;
  assert.equal(geometryPool.slots, 1, 'granted, not the three slots drawn');
  assert.equal(texturePool?.budgetBytes, 1, 'the texture pools granted after');
});
