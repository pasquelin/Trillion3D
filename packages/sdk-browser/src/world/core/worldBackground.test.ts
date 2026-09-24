import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
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
  const calls = { invalidate: 0, schedule: 0 };
  scene._link = createWorldLink({
    contents: {} as never,
    lights: {} as never,
    invalidate: () => calls.invalidate++,
    relight: () => {},
    schedule: () => calls.schedule++,
    background,
  });
  const written: (number | undefined)[] = [];
  const session = {
    setClearColor: (hex?: number) => (written.push(hex), true),
  } as unknown as MeasuredWorld;
  return { scene, background, calls, written, session };
}

test('a background changed after the first frame is the next frame clear colour, no reopen', () => {
  const { scene, background, calls, written, session } = wiredScene();
  scene.background = new Color(0x223344);
  assert.equal(background.write(session), true); // first frame
  scene.background = new Color(0xffcc88);
  // No change of structure: nothing resolved, the session kept, one frame asked.
  assert.equal(calls.schedule, 0);
  assert.equal(calls.invalidate, 2);
  assert.equal(background.write(session), true);
  assert.deepEqual(written, [0x223344, 0xffcc88]);
  // A frame where it did not change writes nothing.
  assert.equal(background.write(session), true);
  assert.equal(written.length, 2);
});

test('a colour written in place is taken too, and a replaced one no longer speaks', () => {
  const { scene, background, written, session } = wiredScene();
  const sky = new Color(0x000000);
  scene.background = sky;
  background.write(session);
  sky.setHex(0x3366ff);
  background.write(session);
  scene.background = null;
  background.write(session);
  sky.setHex(0xffffff);
  assert.equal(background.write(session), true);
  assert.deepEqual(written, [0x000000, 0x3366ff, undefined]);
});

test('a picture background is refused by name', () => {
  const scene = new Scene(noLoad);
  assert.throws(
    () => (scene.background = new Texture(null) as never),
    (error: { code?: string }) => error.code === 'UNSUPPORTED_SCENE_UPDATE',
  );
  assert.equal(scene.background, null);
});

test('the session writes every engine, the default for none, and says when it cannot', () => {
  const taken: number[] = [];
  const able = { setClearColor: (hex: number) => taken.push(hex) } as unknown as RenderBackend;
  const api = (active: RenderBackend, backends: RenderBackend[]) =>
    createExplorerSceneApi({ check: () => {}, active: () => active, backends } as never);
  assert.equal(api(able, [able]).setClearColor(0x102030), true);
  assert.equal(api(able, [able]).setClearColor(), true);
  assert.deepEqual(taken, [0x102030, 0x171d28]);
  assert.equal(api({} as RenderBackend, [{} as RenderBackend]).setClearColor(1), false);
});

test('WebGL2: the composer clears with the new colour and the held frame is broken', () => {
  const scene = hostPageScene();
  let changed = 0;
  hostBackground(scene, () => changed++)(0xff0000);
  const colour = (scene as unknown as { background: { r: number; g: number; b: number } })
    .background;
  assert.deepEqual([colour.r, colour.g, colour.b], [1, 0, 0]);
  assert.equal(changed, 1);
});

test('WebGPU: the passes read the new colour, the frame is not held on the old one', () => {
  const gate = createFrameGateCore(1);
  const scene = createBlendScene(0x000000, []);
  const rt = { setup: { clearColor: 0, scene }, run: { gate } } as unknown as WebgpuPagesRuntime;
  const before = gate.revisions.scene;
  setWebgpuClearColor(rt, 0xffffff);
  assert.equal(rt.setup.clearColor, 0xffffff);
  assert.deepEqual(scene.background, { isColor: true, r: 1, g: 1, b: 1 });
  assert.notEqual(gate.revisions.scene, before);
});
