import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { pagesBounds } from './pagesBounds.ts';
import { emptyWorldBox } from '../../host/world/bounds.ts';
import { asHostLibrary } from '../../host/resources.ts';
import { indexManifestPages, indexManifestBundles } from '../../scene/manifestPageIndex.ts';
import {
  referenceExactPagesBounds,
  referenceIndexManifestPages,
  referenceIndexManifestBundles,
} from '../../../../../bench/oracles/browser/bounds-and-index.ts';
import type { ClusterManifest, Page, Primitive } from '../../../../sdk-core/src/index.ts';

// Batch F, F17: three manifest reads go from a `find` or `flatMap` per mesh/page to a single indexed
// walk. `indexManifestPages`/`indexManifestBundles` (../../scene/manifestPageIndex.ts) and `pagesBounds`
// (./pagesBounds.ts, via `primitiveFinder`) must return exactly what the four `flatMap`s and the
// `find` returned before batch F. The oracles are copied as-is in `oracles/scene-chargement.ts`.
function pageDe(id: number, url: string, geometryUrl?: string): Page {
  const page = { id, url, sha256: url, bytes: 8, count: 3, min: [0, 0, 0], max: [1, 1, 1] } as Page;
  if (geometryUrl)
    page.geometry = { url: geometryUrl, sha256: geometryUrl, bytes: 8 } as Page['geometry'];
  return page;
}
function manifestePartage(): ClusterManifest {
  // A page address shared by two primitives, a page without geometry, a shared bundle.
  const primitiveA = {
    mesh: 0,
    primitive: 0,
    pages: [pageDe(0, 'p/0', 'g/0'), pageDe(1, 'p/1')],
    streams: { pages: [{ url: 'b/0' }, { url: 'b/1' }] },
  } as unknown as Primitive;
  const primitiveB = {
    mesh: 1,
    primitive: 0,
    pages: [pageDe(2, 'p/1', 'g/1'), pageDe(3, 'p/2', 'g/0')], // 'p/1' and 'g/0' already seen elsewhere
    streams: { pages: [{ url: 'b/1' }] },
  } as unknown as Primitive;
  return { primitives: [primitiveA, primitiveB] } as unknown as ClusterManifest;
}

test('indexManifestPages deduplicates pages, geometries and bundles exactly like the reference flatMaps', () => {
  const metadata = manifestePartage();
  const obtenu = indexManifestPages(metadata);
  const attendu = referenceIndexManifestPages(metadata);
  assert.deepEqual(obtenu.pages, attendu.pages);
  assert.deepEqual(obtenu.geometryPages, attendu.geometryPages);
  assert.deepEqual([...obtenu.geometryUrls], [...attendu.geometryUrls]);
  assert.deepEqual([...obtenu.pageIdByUrl], [...attendu.pageIdByUrl]);
});

test('indexManifestBundles deduplicates streaming bundles in their order of appearance', () => {
  const metadata = manifestePartage();
  assert.deepEqual(indexManifestBundles(metadata), referenceIndexManifestBundles(metadata));
});

test('a manifest with no page and no bundle yields empty indexes on both sides', () => {
  const vide = { primitives: [{ mesh: 0, primitive: 0, pages: [] }] } as unknown as ClusterManifest;
  assert.deepEqual(indexManifestPages(vide), referenceIndexManifestPages(vide));
  assert.deepEqual(indexManifestBundles(vide), referenceIndexManifestBundles(vide));
});

test('pagesBounds yields the same box as the reference, a « coarse » page excluded, a mesh without association reported', () => {
  const geometry = new G.GraphGeometry();
  const meshFound = G.mesh(geometry, G.basicSurface());
  const meshMissing = G.mesh(geometry, G.basicSurface());
  const source = new G.GraphGroup();
  source.add(meshFound, meshMissing);
  meshFound.position.set(2, 0, 0);
  const exact = pageDe(0, 'p/0');
  exact.max = [1, 1, 1];
  const grossiere = pageDe(1, 'p/1');
  grossiere.role = 'coarse';
  grossiere.min = [-100, -100, -100];
  grossiere.max = [100, 100, 100];
  const metadata = {
    primitives: [{ mesh: 0, primitive: 0, pages: [exact, grossiere] }],
  } as unknown as ClusterManifest;
  const associations = new Map<G.GraphMesh, { meshes: number; primitives: number }>([
    [meshFound, { meshes: 0, primitives: 0 }],
  ]);
  const manques: G.GraphMesh[] = [],
    manquesRef: G.GraphMesh[] = [];
  const obtenu = pagesBounds(source, associations, metadata, (m) =>
    manques.push(asHostLibrary<G.GraphMesh>(m)),
  );
  const attendu = referenceExactPagesBounds(asHostLibrary(source), associations, metadata, (m) =>
    manquesRef.push(asHostLibrary<G.GraphMesh>(m)),
  );
  assert.deepEqual(Array.from(obtenu), [...attendu.min.toArray(), ...attendu.max.toArray()]);
  assert.deepEqual(manques, manquesRef);
  assert.deepEqual(manques, [meshMissing]);
});

// Batch M4a: `pagesBounds` now computes via core `boxTransform`/`boxUnion` instead of
// `Box3.applyMatrix4`/`union`. Bit-exact on hostile matrices — negative scale, shear, singular
// matrix, NaN — and a depth-3 hierarchy.
test('pagesBounds agrees with the reference on hostile matrices, depth-3 hierarchy', () => {
  const geometry = new G.GraphGeometry();
  const racine = new G.GraphGroup();
  racine.scale.set(-3, 1, 1); // negative scale
  const enfant = new G.GraphGroup();
  enfant.matrixAutoUpdate = false;
  enfant.matrix.set(1, 0.6, 0, 2, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1); // shear, zero z-row
  racine.add(enfant);
  const singulier = G.mesh(geometry, G.basicSurface());
  enfant.add(singulier);
  const petitEnfant = new G.GraphGroup();
  petitEnfant.position.set(NaN, 5, -0);
  enfant.add(petitEnfant);
  const nanMesh = G.mesh(geometry, G.basicSurface());
  petitEnfant.add(nanMesh);
  const source = new G.GraphGroup();
  source.add(racine);
  const page0 = pageDe(0, 'p/0');
  page0.min = [-1, -2, -3];
  page0.max = [4, 5, 6];
  const metadata = {
    primitives: [
      { mesh: 0, primitive: 0, pages: [page0] },
      { mesh: 1, primitive: 0, pages: [page0] },
    ],
  } as unknown as ClusterManifest;
  const associations = new Map<G.GraphMesh, { meshes: number; primitives: number }>([
    [singulier, { meshes: 0, primitives: 0 }],
    [nanMesh, { meshes: 1, primitives: 0 }],
  ]);
  const obtenu = pagesBounds(source, associations, metadata, () => {});
  const attendu = referenceExactPagesBounds(
    asHostLibrary(source),
    associations,
    metadata,
    () => {},
  );
  assert.deepEqual(Array.from(obtenu), [...attendu.min.toArray(), ...attendu.max.toArray()]);
});

// Batch M4a: no allocation per page — one working buffer for the whole loop. Checked by passing
// the same `into` output from one call to the next: that is what comes back, never a new object.
test('pagesBounds reuses the `into` output instead of allocating one per page', () => {
  const geometry = new G.GraphGeometry();
  const mesh = G.mesh(geometry, G.basicSurface());
  const source = new G.GraphGroup();
  source.add(mesh);
  const pages = Array.from({ length: 50 }, (_, i) => {
    const p = pageDe(i, `p/${i}`);
    p.min = [i, i, i];
    p.max = [i + 1, i + 1, i + 1];
    return p;
  });
  const metadata = { primitives: [{ mesh: 0, primitive: 0, pages }] } as unknown as ClusterManifest;
  const associations = new Map<G.GraphMesh, { meshes: number; primitives: number }>([
    [mesh, { meshes: 0, primitives: 0 }],
  ]);
  const into = emptyWorldBox();
  const rendu = pagesBounds(source, associations, metadata, () => {}, into);
  assert.equal(rendu, into, 'the same buffer instance comes back, whatever the number of pages');
});
