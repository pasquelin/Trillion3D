// Batch F fixtures: a cluster manifest and the Three.js scene that goes with it, drawn from a
// seeded generator. Loading reads them once, so the fixture must be large: hundreds of
// primitives, thousands of pages, and the exact coverage the collector checks.
import * as THREE from 'three';
import { graine } from '../../../core/index.ts';
import { materiau, porte } from './scenesCoupe.ts';
import type { PageRec } from '../../../../packages/sdk-browser/pageSelectionTypes.ts';
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../../packages/sdk-core/src/index.ts';

/** A page as `manifesteEtScene` builds it: bounds, cluster error, sphere, index triplet it covers,
 *  plus `sha256`, which `ClusterManifest['primitives'][number]['pages']` requires but nothing in
 *  the loading path this bench measures reads. */
type LoadedPage = Pick<
  PageRec,
  | 'id'
  | 'url'
  | 'min'
  | 'max'
  | 'role'
  | 'level'
  | 'lodError'
  | 'sphere'
  | 'parentError'
  | 'parentSphere'
  | 'group'
  | 'source'
  | 'depthLayer'
> & {
  bytes: number;
  count: number;
  start: number | undefined;
  sha256: string;
};

/** A primitive of the manifest: its pages, and an optional culling hierarchy of one node. */
interface LoadedPrimitive {
  mesh: number;
  primitive: number;
  pass: string;
  pages: LoadedPage[];
  culling?: { stride: number; count: number; nodes: number[] };
}

/** A page: bounds, cluster error, sphere, and index triplet it covers. */
function pageDe(
  alea: () => number,
  id: number,
  url: string,
  triangles: number,
  role: 'exact' | 'coarse',
  depart: number | undefined,
): LoadedPage {
  const cx = (alea() - 0.5) * 20,
    cy = (alea() - 0.5) * 12,
    cz = (alea() - 0.5) * 8;
  const rayon = 0.5 + alea();
  return {
    id,
    url,
    bytes: triangles * 12,
    count: triangles * 3,
    min: [cx - rayon, cy - rayon, cz - rayon],
    max: [cx + rayon, cy + rayon, cz + rayon],
    role,
    level: role === 'coarse' ? 1 : 0,
    lodError: alea() * 2,
    sphere: [cx, cy, cz, rayon * 1.8],
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    depthLayer: id % 3 === 0 ? 1 : 0,
    start: depart,
    sha256: '',
  };
}

/**
 * A manifest and its scene. `primitives` meshes, `pages` exact pages each, plus one coarse
 * page every four primitives; one primitive in five carries a culling hierarchy, which
 * exercises both branches of the box union.
 */
export function manifesteEtScene({
  primitives = 200,
  pages = 12,
  triangles = 8,
  seed = 4201,
}: { primitives?: number; pages?: number; triangles?: number; seed?: number } = {}) {
  const alea = graine(seed);
  const source = new THREE.Group();
  const associations = new Map<THREE.Mesh, { meshes: number; primitives: number }>();
  const indices = new Map<string, Uint32Array>();
  const liste: LoadedPrimitive[] = [];
  let idPage = 0;
  for (let p = 0; p < primitives; p++) {
    const pagesPrimitive: LoadedPage[] = [];
    const morceaux: Uint32Array[] = [];
    let sommet = 0;
    for (let k = 0; k < pages; k++) {
      const url = `page/${p}/${k}`;
      const page = pageDe(alea, idPage++, url, triangles, 'exact', k * triangles * 3);
      const bloc = new Uint32Array(triangles * 3);
      for (let i = 0; i < bloc.length; i++) bloc[i] = sommet++;
      indices.set(url, bloc);
      morceaux.push(bloc);
      pagesPrimitive.push(page);
    }
    if (p % 4 === 0) {
      const url = `coarse/${p}`;
      const page = pageDe(alea, idPage++, url, triangles, 'coarse', undefined);
      indices.set(url, new Uint32Array(triangles * 3));
      pagesPrimitive.push(page);
    }
    const total = morceaux.reduce((n, bloc) => n + bloc.length, 0);
    const sourceIndex = new Uint32Array(total);
    let at = 0;
    for (const bloc of morceaux) {
      sourceIndex.set(bloc, at);
      at += bloc.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(sourceIndex, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sommet * 3), 3));
    const mesh = new THREE.Mesh(geometry, materiau(p));
    mesh.position.set(p % 10, Math.floor(p / 10), 0);
    source.add(mesh);
    associations.set(mesh, { meshes: p, primitives: 0 });
    const primitive: LoadedPrimitive = {
      mesh: p,
      primitive: 0,
      pass: 'opaque',
      pages: pagesPrimitive,
    };
    if (p % 5 === 0) {
      const noeud = [-20, -12, -8, 20, 12, 8, 0, 0, 0, 30, -1, 0, 0, 0, pagesPrimitive.length];
      primitive.culling = { stride: 15, count: 1, nodes: noeud };
    }
    liste.push(primitive);
  }
  source.updateMatrixWorld(true);
  // The rest of `ClusterManifest` (schema, status, key, scope, node counts) is never read by
  // the loading path this bench measures: only `primitives` is.
  const metadata: ClusterManifest = {
    schema: 0,
    status: 'ready',
    key: 'bench',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: [],
    totalNodes: 0,
    primitives: liste,
  };
  return { source, associations, metadata, indices };
}

/** Fields the cones/catalogue paths never read: shared across every fixture page. */
const DUMMY_MATRIX = new THREE.Matrix4();
const DUMMY_BOUNDS: number[] = [0, 0, 0];

/** Pages of a manifest seen as an engine catalogue: bytes, materials, attributes. */
export function catalogueDePages({
  pages = 20000,
  materiaux = 60,
  seed = 5309,
}: { pages?: number; materiaux?: number; seed?: number } = {}): PageRec[] {
  const alea = graine(seed);
  const liste: PageRec[] = [];
  const attributs: { position: THREE.BufferAttribute }[] = [];
  for (let i = 0; i < materiaux; i++) {
    const positions = new Float32Array(3 * 3 * 64);
    for (let k = 0; k < positions.length; k++) positions[k] = alea() * 4 - 2;
    attributs.push({ position: new THREE.BufferAttribute(positions, 3) });
  }
  for (let i = 0; i < pages; i++) {
    const array = i % 9 ? new Uint32Array(3 * (1 + (i % 12))) : undefined;
    if (array) for (let k = 0; k < array.length; k++) array[k] = k % 192;
    liste.push({
      id: i,
      url: `p/${i % (pages - 7)}`,
      clusterId: `p/${i % (pages - 7)}`,
      array,
      attributes: attributs[i % materiaux],
      ...porte(materiau(i % materiaux)),
      triangles: 1,
      indexBytes: 0,
      min: DUMMY_BOUNDS,
      max: DUMMY_BOUNDS,
      depthLayer: 0,
      matrix: DUMMY_MATRIX,
      renderOrder: 0,
      attached: true,
      cone: undefined,
    });
  }
  return liste;
}
