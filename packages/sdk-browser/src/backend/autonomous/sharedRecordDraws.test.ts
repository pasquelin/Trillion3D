// #1235: one record serves every placement of its primitive, and each placement draws it with its own
// instance state (`pageDraws.ts`). A transparent record placed by rows is drawn by one host mesh per
// row, not instanced (`drawnInstancedAt`): the page's bytes, their release and an instance's move
// must reach the instance they belong to, not only the record's first.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createAutonomousGeometry } from './geometry.ts';
import { createPageDraws } from './pageDraws.ts';
import { deplaceInstance } from './instancePose.ts';
import { makeRec, trianglePage } from './pageRec.fixture.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';

type Env = Parameters<typeof createAutonomousGeometry>[0];

/** One transparent record, placed by two rows at x = 1 and x = 2, without bytes yet. */
function twoRows() {
  const rec: PageRec = { ...makeRec(0, 1), url: 'u', transparent: true, array: undefined };
  const pages = [rec];
  const roots: ClusterRoot<PageRec>[] = [1, 2].map((x) => ({
    world: new G.Matrix4().makeTranslation(x, 0, 0),
    pages,
    placement: {} as never,
  }));
  const draws = createPageDraws(roots);
  const surface = G.basicSurface({ transparent: true });
  draws.forEachDraw(rec, (draw) => (draw.material = surface));
  const meshes = new Set<G.Mesh>();
  const scene = {
    add: (mesh: G.Mesh) => meshes.add(mesh),
    remove: (mesh: G.Mesh) => meshes.delete(mesh),
  } as unknown as Env['scene'];
  const shown = [rec, rec];
  const store = createAutonomousGeometry({
    ...{ scene, roots, allPages: [rec], bootstrap: [] },
    views: { live: { shown, shownPacked: [0, 1] }, lists: () => [shown] },
    ...{ byUrl: new Map([['u', [rec]]]), descriptors: new Map(), draws },
    ...{ colorMaterials: new Map(), modifiedPages: new Set<string>() },
  });
  return { rec, store, meshes };
}

test("a page's bytes reach every row of a transparent shared record, and its release too", () => {
  const { rec, store, meshes } = twoRows();
  store.restoreRecords([rec], trianglePage());
  store.sync();
  assert.deepEqual(
    [...meshes].map((mesh) => mesh.matrix.elements[12]).sort(),
    [1, 2],
    'each row draws the page at its own world',
  );
  store.releasePage('u');
  assert.equal(meshes.size, 0, 'the release takes every row off the display graph');
});

test("an instance moved poses its own copy of a shared record's page, not the first copy", () => {
  const rec = makeRec(0, 1),
    pages = [rec];
  const base: ClusterRoot<PageRec> = { world: new G.Matrix4(), pages },
    copy: ClusterRoot<PageRec> = { world: new G.Matrix4(), pages };
  const draws = createPageDraws([base, copy]);
  const [held, moved] = [0, 1].map((packed) => {
    const mesh = G.mesh(new G.Geometry(), G.basicSurface());
    draws.at(packed)!.mesh = mesh;
    return mesh;
  });
  const transform = new G.Matrix4().makeTranslation(3, 0, 0).elements.slice();
  deplaceInstance({ roots: [copy] }, [base], Float64Array.from(transform), draws);
  assert.equal(moved.matrix.elements[12], 3, "the instance's own mesh follows it");
  assert.equal(held.matrix.elements[12], 0, "the base placement's mesh stays");
});
