// #362: a map whose picture moves every frame — a canvas redrawn, a video — is copied into the
// places its texture already holds in the pool, from one working texture of its own that it
// keeps: no session reopened, no texture made per frame. A new size is the one change the
// session cannot take in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadScene } from '../testScenes.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { hostTextureWritten } from '../../../host/textureImport.ts';

type Labelled = { label?: string; destroyed?: boolean };

/** Records every texture write and texture-to-texture copy by the labels of the textures. */
function spy(device: GPUDevice) {
  const writes: { into?: string; first: number }[] = [];
  const copies: { from?: string; into?: string }[] = [];
  const { queue } = device;
  const writeTexture = queue.writeTexture.bind(queue);
  queue.writeTexture = ((destination, data, layout, size) => {
    const bytes = data as Uint8Array;
    writes.push({ into: (destination.texture as Labelled).label, first: bytes[0] });
    writeTexture(destination, data, layout, size);
  }) as GPUQueue['writeTexture'];
  const createEncoder = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = ((descriptor) => {
    const encoder = createEncoder(descriptor);
    encoder.copyTextureToTexture = (source, destination) =>
      void copies.push({
        from: (source.texture as Labelled).label,
        into: (destination.texture as Labelled).label,
      });
    return encoder;
  }) as GPUDevice['createCommandEncoder'];
  return { writes, copies };
}

test('a map redrawn for 120 frames is copied in place, one working texture kept', async () => {
  installGpuGlobals();
  const gpu = mockGpu();
  const pixels = new Uint8Array([255, 0, 0, 255]);
  const map = G.dataTexture(pixels, 1, 1);
  map.needsUpdate = true;
  const fixture = quadScene();
  const surface = fixture.material as G.GraphSurface;
  surface.map = map;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    await backend.flush?.();
    const scratches = () => gpu.textures.filter((t) => t.label === 'Trillion3D texture scratch');
    const made = scratches().length;
    const { writes, copies } = spy(gpu.device);
    for (let frame = 0; frame < 120; frame++) {
      pixels[0] = frame;
      map.needsUpdate = true;
      hostTextureWritten();
      surface.needsUpdate = true;
      assert.equal(backend.refreshMaterials?.(), true, `frame ${frame}: no session reopened`);
      const before = [writes.length, copies.length];
      backend.render(cam);
      const written = writes.slice(before[0]);
      assert.deepEqual(
        written.map((write) => [write.into, write.first]),
        [['Trillion3D texture scratch', frame]],
        `frame ${frame}: the new picture sent once`,
      );
      assert.ok(
        copies
          .slice(before[1])
          .some((copy) => copy.from === 'Trillion3D texture scratch' && copy.into !== copy.from),
        `frame ${frame}: copied into the pool`,
      );
    }
    const live = scratches().slice(made);
    assert.equal(live.length, 1, 'one working texture for 120 frames');
    assert.equal(live[0].destroyed, false, 'kept while the session lives');
    const metrics = backend.metrics() as { textureLiveBytes?: number };
    assert.equal(metrics.textureLiveBytes, 4, 'its bytes declared: one RGBA8 texel');
    // A still image sends nothing.
    const still = writes.length;
    backend.render(cam);
    assert.equal(writes.length, still, 'nothing moved: nothing sent');
    // A new size: the tiles were laid out at the old one.
    map.image = { data: new Uint8Array(16), width: 2, height: 2 };
    map.needsUpdate = true;
    hostTextureWritten();
    assert.equal(backend.refreshMaterials?.(), false, 'a new size asks for a new session');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
