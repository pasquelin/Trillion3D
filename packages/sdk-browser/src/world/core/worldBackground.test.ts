import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { listen } from '../../../../sdk-core/src/world/math/observed.ts';
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { createFrameGateCore } from '../../frame/gateCore.ts';
import { createBlendScene } from '../../cluster/blendSceneRecord.ts';
import { hostBackground } from '../../host/scene/objects.ts';
import { hostPageScene } from '../../host/pageObjects.ts';
import { setWebgpuClearColor } from '../../webgpu/pages/io/clearColor.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';
import { createExplorerSceneApi } from '../api/sceneApi.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import { createWorldBackground } from './worldBackground.ts';
import { createWorldLink } from './worldLink.ts';
import { Scene } from './scene.ts';

const noLoad = () => Promise.reject(new Error('no model in this test'));

/** A world's scene wired as the runtime wires it, its session a recorder of clear colours. */
function wiredScene() {
  const scene = new Scene(noLoad);
  const background = createWorldBackground(scene);
  const calls = { invalidate: 0, schedule: 0, reopen: 0 };
  scene._link = createWorldLink({
    contents: {} as never,
    lights: {} as never,
    invalidate: () => calls.invalidate++,
    relight: () => {},
    schedule: () => calls.schedule++,
  });
  const written: (number | undefined)[] = [];
  const session = {
    setClearColor: (hex?: number) => (written.push(hex), true),
  } as unknown as MeasuredWorld;
  const reopen = () => calls.reopen++;
  return { scene, background, calls, written, session, reopen };
}

test('a background changed after the first frame is the next frame clear colour, no reopen', () => {
  const { scene, background, calls, written, session, reopen } = wiredScene();
  scene.background = new Color(0x223344);
  background.write(session, reopen); // first frame
  scene.background = new Color(0xffcc88);
  // No change of structure: nothing resolved, the session kept, one frame asked.
  assert.equal(calls.schedule, 0);
  assert.equal(calls.invalidate, 2);
  background.write(session, reopen);
  assert.deepEqual(written, [0x223344, 0xffcc88]);
  // A frame where it did not change writes nothing, nor does the same colour set again.
  background.write(session, reopen);
  scene.background = new Color(0xffcc88);
  background.write(session, reopen);
  assert.equal(written.length, 2);
  assert.equal(calls.reopen, 0);
});

test('a session that cannot take the colour in place asks a new one, after its frame', async () => {
  const { scene, background, calls } = wiredScene();
  const refused = { setClearColor: () => false } as unknown as MeasuredWorld;
  const reopen = () => calls.reopen++;
  scene.background = new Color(0x123456);
  background.write(refused, reopen);
  assert.equal(calls.reopen, 0); // not during the frame being drawn
  await Promise.resolve();
  assert.equal(calls.reopen, 1);
  background.write(refused, reopen); // the same colour asks nothing again
  await Promise.resolve();
  assert.equal(calls.reopen, 1);
});

test('a colour written in place is taken too, and a replaced one no longer speaks', () => {
  const { scene, background, written, session, reopen } = wiredScene();
  const sky = new Color(0x000000);
  scene.background = sky;
  background.write(session, reopen);
  sky.setHex(0x3366ff);
  background.write(session, reopen);
  scene.background = null;
  background.write(session, reopen);
  sky.setHex(0xffffff);
  background.write(session, reopen);
  assert.deepEqual(written, [0x000000, 0x3366ff, undefined]);
});

test('a colour another owner hears keeps its owner when the background lets it go', () => {
  const { scene, calls } = wiredScene();
  const shared = new Color(0x000000);
  let heard = 0;
  listen(shared, () => heard++); // a light or a material holding the same colour
  scene.background = shared;
  scene.background = shared; // the same colour set twice is chained once
  const asked = calls.invalidate;
  shared.setHex(0x112233);
  assert.deepEqual([calls.invalidate, heard], [asked + 1, 1]);
  scene.background = null; // one frame asked for the default
  shared.setHex(0x445566);
  assert.deepEqual([calls.invalidate, heard], [asked + 2, 2]);
});

test('a value that says it is a colour and cannot give its hex is refused', () => {
  const scene = new Scene(noLoad);
  assert.throws(
    () => (scene.background = { isColor: true } as never),
    (error: { code?: string }) => error.code === 'UNSUPPORTED_SCENE_UPDATE',
  );
});

test('a picture background is refused by name', () => {
  const scene = new Scene(noLoad);
  assert.throws(
    () => (scene.background = new Texture(null) as never),
    (error: { code?: string }) => error.code === 'UNSUPPORTED_SCENE_UPDATE',
  );
  assert.equal(scene.background, null);
});

test('the session writes every engine it shows, the default for none, and says when one cannot', () => {
  const taken: number[] = [];
  const able = { setClearColor: (hex: number) => taken.push(hex) } as unknown as RenderBackend;
  const api = (active: RenderBackend, backends: RenderBackend[]) =>
    createExplorerSceneApi({ check: () => {}, active: () => active, backends } as never);
  const other: number[] = [];
  const shown = { setClearColor: (hex: number) => other.push(hex) } as unknown as RenderBackend;
  assert.equal(api(able, [able, shown]).setClearColor(0x102030), true);
  assert.equal(api(able, [able, shown]).setClearColor(), true);
  assert.deepEqual(taken, [0x102030, 0x171d28]);
  assert.deepEqual(other, taken); // a compared engine takes it too
  // One compared engine that cannot: only a new session shows the colour on it.
  assert.equal(api(able, [able, {} as RenderBackend]).setClearColor(1), false);
});

test('WebGL2: the composer clears with the new colour and the held frame is broken', () => {
  const scene = hostPageScene();
  let changed = 0;
  const paint = hostBackground(scene, () => changed++);
  paint(0xff0000);
  const host = scene as unknown as { background: { r: number; g: number; b: number } };
  const colour = host.background;
  assert.deepEqual([colour.r, colour.g, colour.b], [1, 0, 0]);
  paint(0x0000ff);
  assert.equal(host.background, colour); // written in place, nothing allocated
  assert.deepEqual([colour.r, colour.g, colour.b], [0, 0, 1]);
  assert.equal(changed, 2);
});

test('WebGPU: the passes read the new colour, the frame is not held on the old one', () => {
  const gate = createFrameGateCore(1);
  const scene = createBlendScene(0x000000, []);
  const rt = { setup: { scene }, run: { clearColor: 0, gate } } as unknown as WebgpuPagesRuntime;
  const { scene: moved, resources } = gate.revisions;
  setWebgpuClearColor(rt, 0xffffff);
  assert.equal(rt.run.clearColor, 0xffffff);
  assert.deepEqual(scene.background, { isColor: true, r: 1, g: 1, b: 1 });
  // The held frame is broken, and nothing is walked again: the scene revision stays.
  assert.equal(gate.revisions.scene, moved);
  assert.notEqual(gate.revisions.resources, resources);
});
