// #362: a map whose picture moves every frame — a canvas redrawn, a video — is copied into the
// places its texture already holds in the pool, from one working texture of its own that it
// keeps, its bytes deducted from the texture pool budget: no session reopened, no texture made
// per frame. A new size is the one change the session cannot take in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { disposeQuadRun } from '../testScenes.fixture.ts';
import { mappedQuadRun } from './mappedQuad.fixture.ts';
import { hostTextureWritten } from '../../../host/textureImport.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../residency/memoryBudgets.ts';

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
  const pixels = new Uint8Array([255, 0, 0, 255]);
  const map = G.dataTexture(pixels, 1, 1);
  const { gpu, fixture, surface, backend, cam } = await mappedQuadRun(map);
  try {
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
    // Those bytes are texture memory: the pool is drawn from what the budget leaves them, as soon
    // as the texture turned live and at every budget set after.
    const drawn = await backend.setMemoryBudgets!({});
    assert.equal(drawn.texturePool?.budgetBytes, DEFAULT_TEXTURE_POOL_BUDGET - 4, 'drawn live');
    const set = await backend.setMemoryBudgets!({ texturePoolBytes: 64 << 20 });
    assert.equal(set.texturePool?.budgetBytes, (64 << 20) - 4, 'a budget set after deducts them');
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
