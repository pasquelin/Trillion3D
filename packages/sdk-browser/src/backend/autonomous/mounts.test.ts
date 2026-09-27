import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { Primitive } from '../../../../sdk-core/src/index.ts';
import { liveRows, triangleBackend } from './triangle.fixture.ts';

/** The fixture's triangle as a resource of its own, at rank `mesh`, its page served at `url`. */
function resourceAt(paged: ReturnType<typeof triangleBackend>['paged'], mesh: number, url: string) {
  const [primitive] = paged.metadata.primitives;
  const [page] = primitive.pages;
  paged.encoded.set(url, paged.encoded.get(page.geometry!.url)!);
  const moved = { ...page, url, geometry: { ...page.geometry!, url } };
  return { ...primitive, mesh, pages: [moved] } as Primitive;
}

test('a resource mounted in place is drawn once its cover is read, and unmounted leaves the rest', async () => {
  const opened = triangleBackend({ placements: liveRows(1) });
  const { backend, camera, geometry, material, paged } = opened;
  try {
    await backend.prepare();
    backend.render(camera);
    const held = backend.metrics();
    assert.equal(held.submittedTriangles, 1);
    const mounts = [
      { url: 'triangle-geometry.bin', rows: liveRows(2) },
      { url: 'mounted-geometry.bin', rows: liveRows(3) },
    ].map(({ url, rows }, i) => {
      const node = G.mesh(geometry, G.basicSurface({ side: G.DOUBLE_SIDE }));
      const association = { meshes: i + 1, primitives: 0, placements: rows };
      return { node, association, primitive: resourceAt(paged, i + 1, url) };
    });
    const mounting = mounts.map((mount) => backend.mountPlacements!(mount));
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 1, 'nothing drawn before its cover is read');
    await Promise.all(mounting);
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 6, 'every row of both resources drawn');
    assert.equal(backend.metrics().residentPages, 2, 'a page shared, a page of its own');
    for (const { association } of mounts) backend.unmountPlacements!(association.placements);
    backend.render(camera);
    const after = backend.metrics();
    assert.equal(after.submittedTriangles, 1, 'the resource the session opened with still drawn');
    assert.equal(after.residentPages, held.residentPages);
    assert.equal(after.geometryAllocationBytes, held.geometryAllocationBytes, 'every copy freed');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});
