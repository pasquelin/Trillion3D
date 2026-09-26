// A world opened the way a page opens it, on the machine stand-in of `world-partition.fixture.ts`:
// a model loaded into a world (`scene.load`), whose session the world runtime opens on the engine's
// own entry point (`openMeasuredWorld` → `prepareExplorer`), on WebGL2.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../../packages/sdk-browser/src/world/core/scene.ts';
import { worldModelLoader } from '../../packages/sdk-browser/src/world/core/worldLoader.ts';
import { createWorldRuntime } from '../../packages/sdk-browser/src/world/core/worldRuntime.ts';
import { createWorldNotices } from '../../packages/sdk-browser/src/world/diagnostic/worldNotices.ts';
import type { MeasuredWorldOptions } from '../../packages/sdk-browser/src/world/session/options.ts';
import { machine } from './world-partition.fixture.ts';

type Opening = {
  camera?: Camera;
  options?: Partial<MeasuredWorldOptions>;
  /** Runs once the session opened, before any frame the test draws, with the bytes read so far. */
  opened?: (read: { bytes: number }) => void;
};

/** The world runtime holding `pointer`'s model, its session open; `read` counts the bytes fetched. */
export async function openedWorld(t: TestContext, pointer: URL, opening: Opening = {}) {
  const { read, canvas } = machine(t, pointer);
  const camera = opening.camera ?? new Camera('perspective');
  const ready = Promise.resolve();
  const scene = new Scene(worldModelLoader(ready, undefined, () => 'webgl2'));
  let failure: unknown;
  const runtime = createWorldRuntime({
    canvas,
    scene,
    ready: () => ready,
    camera: () => camera,
    options: () => ({ manifestUrl: '', renderer: 'webgl2', ...opening.options }),
    opened: () => opening.opened?.(read),
    frame: () => {},
    drawn: () => false,
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    diagnostic: { notices: createWorldNotices(), failed: (e) => (failure = e), opening() {} },
  });
  t.after(() => runtime.dispose());
  await scene.load(pointer.href);
  await runtime.settled();
  const session = runtime.explorer;
  assert.ok(session, `the session opened: ${String(failure)}`);
  return { runtime, session, read };
}
