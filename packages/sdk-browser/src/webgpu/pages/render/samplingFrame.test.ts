// #360, #361: a sampling written on a map reaches its texture's page-table header before the image
// that follows is submitted — that very image draws it —, so a host that renders on demand sees
// the change at its next image, not one image late.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { disposeQuadRun } from '../testScenes.fixture.ts';
import { mappedQuadRun } from './mappedQuad.fixture.ts';
import { hostTextureWritten } from '../../../host/textureImport.ts';

test('a filter written on a map is in its header before the image that draws it is submitted', async () => {
  const map = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  const { gpu, fixture, backend, cam } = await mappedQuadRun(map);
  try {
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
