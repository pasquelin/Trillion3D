// #875: a paged transparent item read its vertices from host buffers built out of `source.bin`.
// It now reads every attribute from its quantized geometry pages, as the opaque rows do, and only
// the meshes the cut never sees — shared-blend and transmissive — keep buffers of their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { pagedQuad, FIRST, SECOND, type PagedQuad } from '../pages/pagedQuad.fixture.ts';
import { createWebgpuPagesRuntime } from '../pages/runtime.ts';
import { prepareWebgpuPages } from '../pages/prepare/prepare.ts';
import { ensurePageTable } from '../pages/render/encodeDraws.ts';
import { disposeWebgpuPages } from '../pages/io/metrics.ts';
import { FLAG_CLUSTER_PAGE, FLAG_HAS_TANGENT } from '../../visibility/types.ts';

/** The quad of two quantized clusters, drawn as `pass` says under `surface`, prepared on the mock
 *  device with its page reader. */
async function preparedQuad(pass: string, surface: G.GraphSurface) {
  installGpuGlobals();
  const fixture = pagedQuad([{ corners: FIRST }, { corners: SECOND }]);
  fixture.metadata.primitives[0].pass = pass as never;
  const [mesh] = fixture.associations.keys();
  mesh.material = surface;
  mesh.geometry.setAttribute('normal', G.floatAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  mesh.geometry.setAttribute('uv', G.floatAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  mesh.geometry.setAttribute('tangent', G.floatAttribute(new Array(16).fill(1), 4));
  const mock = mockGpu();
  const rt = createWebgpuPagesRuntime({
    ...fixture,
    gpuDevice: mock.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    readGeometryPage: async (url: string) => fixture.bytes.get(url)!,
  } as never);
  await prepareWebgpuPages(rt, mock.device);
  return { rt, fixture, mesh, device: mock.device };
}

const release = async (rt: Awaited<ReturnType<typeof preparedQuad>>['rt'], fixture: PagedQuad) => {
  await disposeWebgpuPages(rt);
  fixture.geometry.dispose();
};

test('a paged transparent item owns no host buffer and draws each cluster from its page', async () => {
  const { rt, fixture, mesh, device } = await preparedQuad(
    'clustered-blend',
    G.basicSurface({ transparent: true, opacity: 0.5 }),
  );
  try {
    const [item] = rt.blendState.blendGpu;
    assert.equal(item.paged, true);
    assert.deepEqual(
      [item.position, item.index, item.uv, item.normal],
      [undefined, undefined, undefined, undefined],
    );
    assert.equal(item.flags & FLAG_CLUSTER_PAGE, FLAG_CLUSTER_PAGE, 'the shader decodes its pages');
    assert.equal(item.flags & FLAG_HAS_TANGENT, 0, 'a page stores no tangent');
    assert.equal(rt.vis.geometryBlocks.has(mesh.geometry.attributes), false, 'no float geometry');
    // Once resident, each cluster's span is its slot and the corners its page declares.
    ensurePageTable(rt, device);
    rt.services.syncRows();
    const { spans, entryOfPage } = rt.blendState.table!;
    fixture.encoded.forEach((page, id) => {
      const entry = entryOfPage[id];
      assert.equal(spans[entry * 4 + 1], page.indexCount);
      assert.equal(spans[entry * 4], rt.gpu.cache!.get(`g${id}`)!.offset / 4);
    });
  } finally {
    await release(rt, fixture);
  }
});

test('shared-blend and transmissive meshes keep their host buffers', async () => {
  const cases: [string, G.GraphSurface][] = [
    ['shared-blend', G.basicSurface({ transparent: true, opacity: 0.5 })],
    ['exact-clusters', G.physicalSurface({ transmission: 1 })],
  ];
  for (const [pass, surface] of cases) {
    const { rt, fixture } = await preparedQuad(pass, surface);
    try {
      const [item] = rt.blendState.blendGpu;
      assert.equal(!!item.paged, false, pass);
      for (const buffer of [item.position, item.index, item.uv, item.normal])
        assert.ok(buffer, `${pass} reads its own buffers`);
      assert.equal(item.flags & FLAG_CLUSTER_PAGE, 0);
      assert.equal(item.flags & FLAG_HAS_TANGENT, FLAG_HAS_TANGENT, 'its tangents are read');
    } finally {
      await release(rt, fixture);
    }
  }
});
