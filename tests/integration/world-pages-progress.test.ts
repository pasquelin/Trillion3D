// A world's first pages are heard while they land, counted on the pages its view reads (#408). The
// repository's compiled avenue is loaded into a world (`scene.load`) whose session the world
// runtime opens on the engine's own entry point, on a WebGL2 context that answers all. Frames drawn
// before the wait — what the page's loop does while it opens — may read every page first: the wait
// still counts them, `total` never 0 on a world that draws something.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { JobProgress } from '../../packages/sdk-core/src/index.ts';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../../packages/sdk-browser/src/world/core/scene.ts';
import { worldModelLoader } from '../../packages/sdk-browser/src/world/core/worldLoader.ts';
import { createWorldRuntime } from '../../packages/sdk-browser/src/world/core/worldRuntime.ts';
import { awaitViewPages } from '../../packages/sdk-browser/src/world/core/worldSession.ts';
import { createWorldNotices } from '../../packages/sdk-browser/src/world/diagnostic/worldNotices.ts';
import { machine } from './world-partition.fixture.ts';

const POINTER = new URL(
  '../../site/assets/examples/detail-by-pixel-error/cache/native/full/manifest.json',
  import.meta.url,
);

/** The `pages` events of `world.awaitPages` on the avenue; `drawnFirst`, after frames drawn as a
 *  loop draws them until the view lacks nothing: each asks a batch of the missing pages, and the
 *  next waits until they landed. */
async function heardPages(t: test.TestContext, drawnFirst: boolean) {
  const { canvas } = machine(t, POINTER);
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgl2'));
  let failure: unknown;
  const runtime = createWorldRuntime({
    canvas,
    scene,
    ready: () => ready,
    camera: () => new Camera('perspective'),
    options: () => ({ manifestUrl: '', renderer: 'webgl2' }),
    opened: () => {},
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), failed: (e) => (failure = e), opening() {} },
  });
  t.after(() => runtime.dispose());
  await scene.load(POINTER.href);
  await runtime.settled();
  const session = runtime.explorer;
  assert.ok(session, `the session opened: ${String(failure)}`);
  const lacks = () => session.backends[0]!.pendingUrls?.().length;
  if (drawnFirst)
    do {
      runtime.render();
      await session.flush();
      await new Promise(setImmediate); // the reads the frame asked land between two frames
    } while (lacks());
  const heard: JobProgress[] = [];
  await awaitViewPages(
    runtime,
    () => session,
    (event) => heard.push(event),
  );
  return { heard, lacks: lacks() };
}

/** Every event is `pages`, `total` above 0, `completed` rising to it, the last one equal. */
function assertCounted(heard: JobProgress[]) {
  assert.ok(heard.length > 0, 'the first pages are heard');
  assert.ok(heard.every((event) => event.phase === 'pages'));
  const totals = new Set(heard.map((event) => event.total));
  assert.equal(totals.size, 1, `one count for the whole wait: ${[...totals]}`);
  const total = heard[0]!.total as number;
  assert.ok(total > 0, 'the view reads pages');
  const done = heard.map((event) => event.completed as number);
  assert.ok(
    done.every((count, at) => at === 0 || count >= done[at - 1]!),
    `never back: ${done}`,
  );
  assert.equal(done.at(-1), total, 'the last event closes the count');
  return total;
}

test('awaitPages hears each first page land, on the pages the view reads', async (t) => {
  const { heard, lacks } = await heardPages(t, false);
  const total = assertCounted(heard);
  assert.ok(heard.length > 2, 'the pages it lacked are heard one by one');
  assert.ok((heard[0]!.completed as number) < total, 'it started lacking some');
  assert.equal(lacks, 0, 'the view lacks nothing once it settles');
});

test('awaitPages counts the pages frames read before it: all resident, never 0 of 0', async (t) => {
  const { heard } = await heardPages(t, true);
  const total = assertCounted(heard);
  assert.equal(heard[0]!.completed, total, 'nothing left to read: resident at once');
});
