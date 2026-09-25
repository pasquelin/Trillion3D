// #725, #483 rule 5: out of memory on a frame target is absorbed. The targets are granted under
// the device's out-of-memory check before a frame draws with them; a refusal drops Hi-Z first,
// and what cannot be made is refused by name, never reported as a lost device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { camera, quadBackend, quadScene } from '../testScenes.fixture.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { refusing } from './refusing.fixture.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';

const COLOR = 'Trillion3D display color';
type Backend = WebgpuPagesBackend & { pendingFrame(): Promise<boolean> };

/** A quad backend drawn once at 32 × 32, on a device that answers the display colour made at
 *  48 × 48 with `refuse`, told whether the Hi-Z pyramid is alive; then resized to 48 × 48. */
async function resized(refuse: (hizAlive: boolean) => boolean) {
  installGpuGlobals();
  const scene = quadScene();
  const gpu = refusing(
    'createTexture',
    COLOR,
    (raise, { size }) => {
      const hizAlive = gpu.textures.some(
        (texture) => texture.format === 'r32float' && !texture.label && !texture.destroyed,
      );
      if (size?.width === 48 && refuse(hizAlive)) raise('Out of memory');
    },
    {
      packed: packDagSelection(
        collectClusterPages(scene.source, scene.metadata, scene.indices, scene.associations).roots,
      ),
    },
  );
  const viewport: [number, number] = [32, 32];
  const events: BackendDiagnostic[] = [];
  const mounted = quadBackend(gpu.device, {
    viewport,
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
  });
  const { fixture } = mounted,
    backend = mounted.backend as Backend;
  await backend.prepare();
  const cam = camera();
  backend.render(cam);
  await backend.flush();
  viewport[0] = viewport[1] = 48;
  const said = (phase: string) => events.filter((event) => event.phase === phase);
  const alive = (label: string) =>
    gpu.textures.filter((texture) => texture.label === label && !texture.destroyed);
  /** The frame drawn whole: both quad clusters, once its readback is in. */
  const complete = async () => {
    await backend.flush();
    backend.render(cam);
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1'], 'the frame is complete');
  };
  const dispose = () => {
    scene.geometry.dispose();
    scene.material.dispose();
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  };
  return { gpu, backend, cam, said, alive, complete, dispose };
}

test('a refused target grant holds the frame, then draws it complete', async () => {
  let refusals = 1;
  const s = await resized(() => refusals-- > 0);
  try {
    // The device answers only once the frame has been asked.
    let answer = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const pop = s.gpu.device.popErrorScope.bind(s.gpu.device);
    Object.assign(s.gpu.device, { popErrorScope: async () => (await answered, pop()) });
    const draws = s.gpu.draws.length;
    s.backend.render(s.cam);
    assert.equal(s.backend.metrics().frameHeld, true, 'no frame draws while its targets are asked');
    assert.equal(s.gpu.draws.length, draws, 'nothing is drawn into targets not granted');
    const next = s.backend.pendingFrame();
    answer();
    assert.equal(await next, true, 'the answer asks the next frame');
    s.backend.render(s.cam);
    assert.equal(s.backend.metrics().frameHeld, false);
    assert.ok(s.gpu.draws.length > draws, 'the frame is drawn');
    assert.deepEqual(
      s.alive(COLOR).map((texture) => texture.width),
      [48],
      'drawn into the granted targets, at the new size',
    );
    await s.complete();
    assert.equal(s.said('gpu-device-lost').length, 0, 'never reported as a lost device');
  } finally {
    s.dispose();
  }
});

test('under pressure, Hi-Z goes first: the targets are granted without it, all others kept', async () => {
  // The device lacks what Hi-Z holds: the targets fit once it is released.
  const s = await resized((hizAlive) => hizAlive);
  try {
    s.backend.render(s.cam);
    assert.equal(await s.backend.pendingFrame(), true);
    s.backend.render(s.cam);
    const [refused] = s.said('gpu-out-of-memory');
    assert.equal(refused?.context.pool, 'frame-targets');
    assert.equal(refused?.context.dropped, 'hi-z');
    for (const label of [COLOR, 'Trillion3D opaque depth', 'Trillion3D HDR lighting'])
      assert.deepEqual(
        s.alive(label).map((texture) => texture.width),
        [48],
        `${label} is granted at the new size`,
      );
    assert.equal(s.said('frame-targets-refused').length, 0);
    await s.complete();
    assert.equal(s.said('gpu-device-lost').length, 0);
  } finally {
    s.dispose();
  }
});

test('an impossible target is refused by name, the frame held, never a lost device', async () => {
  const s = await resized(() => true);
  try {
    const draws = s.gpu.draws.length;
    s.backend.render(s.cam);
    assert.equal(await s.backend.pendingFrame(), true);
    s.backend.render(s.cam);
    const [refused] = s.said('frame-targets-refused');
    assert.equal(refused?.context.code, 'WEBGPU_FRAME_TARGETS_REFUSED');
    assert.equal(refused?.context.reason, 'gpu-out-of-memory');
    assert.deepEqual([refused?.context.width, refused?.context.height], [48, 48]);
    assert.equal(s.backend.metrics().frameHeld, true, 'the previous image stays');
    assert.equal(s.gpu.draws.length, draws, 'nothing is drawn');
    assert.equal(await s.backend.pendingFrame(), false, 'the loop waits for another size');
    assert.equal(s.said('gpu-device-lost').length, 0, 'never reported as a lost device');
  } finally {
    s.dispose();
  }
});

test('frame targets refused at prepare are refused by name', async () => {
  installGpuGlobals();
  const { device } = refusing('createTexture', COLOR);
  const { fixture, backend } = quadBackend(device);
  try {
    await assert.rejects(backend.prepare(), /WEBGPU_FRAME_TARGETS_REFUSED/);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
