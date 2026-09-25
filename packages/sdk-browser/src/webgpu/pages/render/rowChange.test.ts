// #198: the row change keeps the hold mask's `rowsDirty` bit set until an image consumes it. Only the
// visibility path used to, so the fallback draw — the image encoded while the visibility pass is not
// ready — left it set, drawn rows or none. The submitted image now consumes it, on every path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST_IDENTITY } from '../../../backend/pagesBackend.fixture.ts';
import { collectClusterPages } from '../../../page/selection/selection.ts';
import { packDagSelection } from '../../../gpu/dag/selection.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { createWebgpuPagesRuntime } from '../runtime.ts';
import { prepareWebgpuBackend } from '../prepare/prepare.ts';
import { disposeWebgpuPages } from '../io/metrics.ts';
import { renderWebgpuPages } from './render.ts';
import { flushWebgpuPages } from './flush.ts';
import { encodeDraws } from './encodeDraws.ts';
import { camera, quadScene } from '../testScenes.fixture.ts';

async function fallbackConsumes(blendOnly: boolean) {
  installGpuGlobals();
  const scene = quadScene();
  if (blendOnly) {
    scene.metadata.primitives[0].pass = 'clustered-blend';
    scene.material.transparent = true;
    scene.material.opacity = 0.5;
  }
  const collected = collectClusterPages(
    scene.source,
    scene.metadata,
    scene.indices,
    scene.associations,
  );
  const gpu = mockGpu({ packed: packDagSelection(collected.roots) });
  const rt = createWebgpuPagesRuntime({
    ...scene,
    metadata: { ...scene.metadata, ...MANIFEST_IDENTITY },
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await prepareWebgpuBackend(rt, gpu.device);
    renderWebgpuPages(rt, camera());
    await flushWebgpuPages(rt);
    const { rows } = rt.layout;
    assert.equal(rows.packedCount, blendOnly ? 0 : 2, 'the view packs its opaque rows alone');
    // The visibility targets are gone until the next allocation: this image is the fallback draw.
    rt.vis.visView = undefined;
    rows.rowsChanged = true;
    const submitted = gpu.submits.length;
    encodeDraws(rt, gpu.device, rt.run.gate.cam);
    assert.ok(gpu.submits.length > submitted, 'the fallback image was submitted');
    assert.equal(rows.rowsChanged, false, 'the submitted fallback image consumed the row change');
  } finally {
    disposeWebgpuPages(rt);
    scene.geometry.dispose();
    scene.material.dispose();
  }
}

test('#198: the fallback draw consumes the row change of the rows it drew', () =>
  fallbackConsumes(false));

test('#198: the fallback draw with no drawable row consumes the row change', () =>
  fallbackConsumes(true));
