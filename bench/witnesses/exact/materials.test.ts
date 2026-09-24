import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { createExactPagesMaterials } from './materials.ts';
import { clusterColor } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import { hashId, screenErrorColor } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import { triangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import { pageDiagnostics } from '../../../packages/sdk-browser/src/host/pageDiagnostics.ts';
import type { EngineCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { DiagnosticMode } from '../../../packages/sdk-core/src/index.ts';

/** A cluster page as this file reads it: the host declaration, the identity, and the two
 *  facts the pages and the level-of-detail views colour by. */
function page(
  clusterId: string,
  declaration: G.GraphSurface | G.GraphSurface[],
  extra: Partial<PageRec> = {},
) {
  return { clusterId, declaration, lodError: 0, ...extra } as unknown as PageRec;
}
function indexedQuad() {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    G.floatAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]));
  return geometry;
}
function materials(diagnostic: DiagnosticMode, blendCopies: G.GraphMesh[] = []) {
  const options = {
    blendCopies,
    viewport: [640, 400] as const,
    diagnostic,
    cam: undefined as EngineCamera | undefined,
    lastPixelError: 1,
  };
  return { options, made: createExactPagesMaterials(options) };
}

test('the beauty view hands back the host declaration itself, untouched', () => {
  const declaration = G.standardSurface();
  const { made } = materials('beauty');
  assert.equal(made.materialFor(page('c1', declaration)), declaration);
  made.disposeMaterials();
  declaration.dispose();
});

test('the wireframe view is one unshaded vertex-colour surface per cluster, on the declared side', () => {
  const declaration = G.standardSurface({ side: G.DOUBLE_SIDE });
  const { made } = materials('wireframe');
  const first = made.materialFor(page('c1', declaration)) as G.GraphSurface;
  assert.equal(first.family, 'basic');
  assert.equal(first.vertexColors, true);
  assert.equal(first.wireframe, false, 'the triangles are coloured, not outlined');
  assert.equal(first.side, G.DOUBLE_SIDE);
  assert.equal(made.materialFor(page('c1', declaration)), first, 'one surface per cluster');
  assert.notEqual(made.materialFor(page('c2', declaration)), first);
  made.disposeMaterials();
  declaration.dispose();
});

test('the pages, level-of-detail and cluster views colour by residency, role and identity', () => {
  const declaration = G.standardSurface();
  const resident = page('c1', declaration, { array: new Uint32Array(1) }),
    loading = page('c2', declaration);
  const pages = materials('pages').made;
  assert.equal(((pages.materialFor(resident) as G.GraphSurface).color as G.Color).getHex(), 0x34d399);
  assert.equal(((pages.materialFor(loading) as G.GraphSurface).color as G.Color).getHex(), 0xfbbf24);
  assert.equal(pages.materialFor(page('c9', declaration)), pages.materialFor(loading));
  const lod = materials('lod').made;
  const coarse = page('c1', declaration, { role: 'coarse' }),
    exact = page('c2', declaration, { role: 'exact' });
  assert.equal(((lod.materialFor(coarse) as G.GraphSurface).color as G.Color).getHex(), 0xf59e0b);
  assert.equal(((lod.materialFor(exact) as G.GraphSurface).color as G.Color).getHex(), 0x38bdf8);
  const clusters = materials('clusters').made;
  const tint = clusters.materialFor(page('c1', declaration)) as G.GraphSurface;
  assert.deepEqual((tint.color as G.Color).toArray(), clusterColor('c1', 0.75).toArray());
  for (const set of [pages, lod, clusters]) set.disposeMaterials();
  declaration.dispose();
});

test('the screen-error view rewrites its colour from the error the page projects', () => {
  const declaration = G.standardSurface();
  const { options, made } = materials('screen-error');
  const rec = page('c1', declaration);
  assert.equal(((made.materialFor(rec) as G.GraphSurface).color as G.Color).getHex(), 0x00ff1f);
  options.cam = {} as EngineCamera;
  const painted = made.materialFor(rec) as G.GraphSurface;
  assert.deepEqual((painted.color as G.Color).toArray(), screenErrorColor(0, 1));
  made.disposeMaterials();
  declaration.dispose();
});

test('painting a page swaps the expanded triangles in under wireframe and the source elsewhere', () => {
  const geometry = indexedQuad(),
    declaration = G.standardSurface();
  const mesh = G.mesh(new G.GraphGeometry(), declaration);
  const wireframe = materials('wireframe').made;
  wireframe.paint(mesh, geometry, declaration, hashId('c1'));
  assert.equal(mesh.geometry, triangleGeometry(geometry, pageDiagnostics, hashId('c1')));
  assert.equal(mesh.geometry.getIndex(), null);
  assert.equal(mesh.geometry.getAttribute('color').count, 6);
  materials('pages').made.paint(mesh, geometry, declaration);
  assert.equal(mesh.geometry, geometry, 'every other view draws the source geometry');
  wireframe.disposeMaterials();
  geometry.dispose();
  declaration.dispose();
});

test('a transparent copy is repainted like a page, on its own identity, and given back on beauty', () => {
  const geometry = indexedQuad(),
    declaration = G.standardSurface({ transparent: true, opacity: 0.4 });
  const copy = G.mesh(new G.GraphGeometry(), G.basicSurface());
  copy.userData.sourceGeometry = geometry;
  copy.userData.sourceMaterial = declaration;
  const wireframe = materials('wireframe', [copy]).made;
  wireframe.paintBlend();
  const painted = copy.material as G.GraphSurface;
  assert.equal(painted.family, 'basic');
  assert.equal(painted.vertexColors, true);
  assert.equal(copy.geometry, triangleGeometry(geometry, pageDiagnostics, hashId(String(copy.id))));
  wireframe.paintBlend();
  assert.equal(copy.material, painted, 'one surface per transparent copy, kept across frames');
  const beauty = materials('beauty', [copy]).made;
  beauty.paintBlend();
  assert.equal(copy.material, declaration, 'the transparent copy gets its own surface back');
  assert.equal(copy.geometry, geometry);
  wireframe.disposeMaterials();
  geometry.dispose();
  declaration.dispose();
});

test('disposing releases every surface the views made, and none of the host declarations', () => {
  const declaration = G.standardSurface();
  const { made } = materials('clusters');
  const tint = made.materialFor(page('c1', declaration)) as G.GraphSurface;
  let disposed = 0;
  tint.released.add(() => disposed++);
  made.disposeMaterials();
  assert.equal(disposed, 1);
  assert.equal(made.materialFor(page('c1', declaration)), tint, 'the table is the caller’s');
  declaration.dispose();
});
