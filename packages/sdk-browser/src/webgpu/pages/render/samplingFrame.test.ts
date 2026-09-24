// #360, #361: a sampling written on a map reaches its texture's page-table header before the image
// that follows is submitted — that very image draws it —, so a host that renders on demand sees
// the change at its next image, not one image late.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadScene } from '../testScenes.fixture.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { hostTextureWritten } from '../../../host/textureImport.ts';

test('a filter written on a map is in its header before the image that draws it is submitted', async () => {
  installGpuGlobals();
  const gpu = mockGpu();
  const map = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  map.needsUpdate = true;
  const fixture = quadScene();
  (fixture.material as G.GraphSurface).map = map;
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
    const header = () =>
      gpu.writes.filter((write) => write.label?.startsWith('Trillion3D texture pages'));
    const before = header().length;
    map.magFilter = G.HOST_FILTER_LINEAR;
    map.needsUpdate = true;
    hostTextureWritten();
    (fixture.material as G.GraphSurface).needsUpdate = true;
    backend.refreshMaterials?.();
    const submitted = gpu.submits.length;
    backend.render(cam);
    const written = header().slice(before);
    assert.ok(written.length > 0, 'the header was written');
    // The image is the render's last submit: the copy of the picture `needsUpdate` moved (#362)
    // is submitted before it.
    const submit = gpu.submits.slice(submitted).at(-1);
    assert.ok(submit !== undefined, 'the image was submitted');
    assert.ok(
      written.every((write) => write.seq < submit),
      'written before the image that reads it is submitted',
    );
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
