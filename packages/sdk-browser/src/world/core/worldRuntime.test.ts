import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import { createWorldRuntime } from './worldRuntime.ts';
import { Scene } from './scene.ts';

test('a scene change with nothing to draw does not stop the next one from opening a session', async () => {
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const openings: unknown[] = [];
  const runtime = createWorldRuntime({
    canvas: { clientWidth: 0, clientHeight: 0, width: 300, height: 150 } as HTMLCanvasElement,
    scene,
    camera: () => new Camera(),
    options: () => ({ manifestUrl: '', interactive: true }),
    opened: () => {},
    frame: () => {},
    display: () => ({ exposure: 1, toneMapping: 'aces' }),
    ready: Promise.resolve(),
    // Node has no GPU: a session asked for fails to open, which is how the attempt is seen.
    failed: (error) => openings.push(error),
    notices: createWorldNotices(),
  });
  // A page sets its background before its model arrives: that change has nothing to open.
  // Timers, not `settled()`: a handle held forever made `settled()` spin without end.
  const turn = () => new Promise((done) => setTimeout(done, 10));
  scene.background = null;
  await turn();
  assert.equal(openings.length, 0);
  scene.add(new Mesh(box()));
  for (let wait = 0; wait < 100 && !openings.length; wait++) await turn();
  assert.equal(openings.length, 1, 'the mesh asks for a session');
  runtime.dispose();
});
