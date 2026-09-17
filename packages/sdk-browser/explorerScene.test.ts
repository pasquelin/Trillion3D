import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPreparedScene } from './explorerScene.ts';
import { exactPagesBounds } from './exactPagesBounds.ts';
import { emptyWorldBox } from './hostWorldBounds.ts';
import { indexManifestPages, indexManifestBundles } from './manifestPageIndex.ts';
import {
  referenceExactPagesBounds,
  referenceIndexManifestPages,
  referenceIndexManifestBundles,
} from './bench/oracles/scene-chargement.mjs';
import type { ClusterManifest, Page, Primitive } from '../sdk-core/index.ts';

const manifest = { primitives: [] } as unknown as ClusterManifest;

// Comportement 13 : `textureIndices` couvre chaque texture que le glTF associe à un rang, et rien
// d'autre — ni les objets qui ne sont pas des textures, ni une association sans rang de texture.
test('loadPreparedScene indexes every glTF texture association and nothing else', async (t) => {
  const scene = new THREE.Group();
  const [textureA, textureB, textureC] = [
    new THREE.Texture(),
    new THREE.Texture(),
    new THREE.Texture(),
  ];
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const associations = new Map<object, { textures?: number; meshes?: number }>([
    [textureA, { textures: 0 }],
    [textureB, { textures: 2 }],
    [textureC, {}],
    [mesh, { meshes: 0 }],
  ]);
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async () => ({
    scene,
    parser: { associations },
  }));
  const result = await loadPreparedScene(
    {},
    manifest,
    'scene.gltf',
    'http://localhost/',
    'full',
    false,
    undefined,
    () => {},
    () => {},
  );
  assert.equal(result.textureIndices.size, 2);
  assert.equal(result.textureIndices.get(textureA), 0);
  assert.equal(result.textureIndices.get(textureB), 2);
  assert.equal(result.textureIndices.has(textureC), false);
});

// Lot F, F17 : trois lectures du manifeste passent d'un `find` ou d'un `flatMap` par maillage/page à
// un seul parcours indexé. `indexManifestPages`/`indexManifestBundles` (manifestPageIndex.ts) et
// `exactPagesBounds` (exactPagesBounds.ts, via `primitiveFinder`) doivent rendre exactement ce que
// rendaient les quatre `flatMap` et le `find` d'avant le lot F. Les oracles sont recopiés tels quels
// dans `oracles/scene-chargement.mjs`.
function pageDe(id: number, url: string, geometryUrl?: string): Page {
  const page = { id, url, sha256: url, bytes: 8, count: 3, min: [0, 0, 0], max: [1, 1, 1] } as Page;
  if (geometryUrl)
    page.geometry = { url: geometryUrl, sha256: geometryUrl, bytes: 8 } as Page['geometry'];
  return page;
}
function manifestePartage(): ClusterManifest {
  // Une adresse de page partagée entre deux primitives, une page sans géométrie, un paquet partagé.
  const primitiveA = {
    mesh: 0,
    primitive: 0,
    pages: [pageDe(0, 'p/0', 'g/0'), pageDe(1, 'p/1')],
    streams: { pages: [{ url: 'b/0' }, { url: 'b/1' }] },
  } as unknown as Primitive;
  const primitiveB = {
    mesh: 1,
    primitive: 0,
    pages: [pageDe(2, 'p/1', 'g/1'), pageDe(3, 'p/2', 'g/0')], // 'p/1' et 'g/0' déjà vus ailleurs
    streams: { pages: [{ url: 'b/1' }] },
  } as unknown as Primitive;
  return { primitives: [primitiveA, primitiveB] } as unknown as ClusterManifest;
}

test('indexManifestPages dédoublonne pages, géométries et paquets exactement comme les flatMap de référence', () => {
  const metadata = manifestePartage();
  const obtenu = indexManifestPages(metadata);
  const attendu = referenceIndexManifestPages(metadata);
  assert.deepEqual(obtenu.pages, attendu.pages);
  assert.deepEqual(obtenu.geometryPages, attendu.geometryPages);
  assert.deepEqual([...obtenu.geometryUrls], [...attendu.geometryUrls]);
  assert.deepEqual([...obtenu.pageIdByUrl], [...attendu.pageIdByUrl]);
});

test('indexManifestBundles dédoublonne les paquets de streaming dans leur ordre d’apparition', () => {
  const metadata = manifestePartage();
  assert.deepEqual(indexManifestBundles(metadata), referenceIndexManifestBundles(metadata));
});

test('un manifeste sans aucune page ni paquet rend des index vides des deux côtés', () => {
  const vide = { primitives: [{ mesh: 0, primitive: 0, pages: [] }] } as unknown as ClusterManifest;
  assert.deepEqual(indexManifestPages(vide), referenceIndexManifestPages(vide));
  assert.deepEqual(indexManifestBundles(vide), referenceIndexManifestBundles(vide));
});

test('exactPagesBounds rend la même boîte que la référence, une page « coarse » exclue, un maillage sans association signalé', () => {
  const geometry = new THREE.BufferGeometry();
  const meshFound = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const meshMissing = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const source = new THREE.Group();
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
  const associations = new Map<THREE.Mesh, { meshes: number; primitives: number }>([
    [meshFound, { meshes: 0, primitives: 0 }],
  ]);
  const manques: THREE.Mesh[] = [],
    manquesRef: THREE.Mesh[] = [];
  const obtenu = exactPagesBounds(source, associations, metadata, (m) => manques.push(m));
  const attendu = referenceExactPagesBounds(source, associations, metadata, (m) =>
    manquesRef.push(m),
  );
  assert.deepEqual(Array.from(obtenu), [...attendu.min.toArray(), ...attendu.max.toArray()]);
  assert.deepEqual(manques, manquesRef);
  assert.deepEqual(manques, [meshMissing]);
});

// Lot M4a : `exactPagesBounds` calcule maintenant par `boxTransform`/`boxUnion` du socle au lieu de
// `Box3.applyMatrix4`/`union`. Vérifié au bit près sur des matrices hostiles — échelle négative,
// cisaillement, matrice singulière, NaN — et une hiérarchie de profondeur 3.
test('exactPagesBounds s’accorde avec la référence sur des matrices hostiles, hiérarchie de profondeur 3', () => {
  const geometry = new THREE.BufferGeometry();
  const racine = new THREE.Group();
  racine.scale.set(-3, 1, 1); // échelle négative
  const enfant = new THREE.Group();
  enfant.matrixAutoUpdate = false;
  enfant.matrix.set(1, 0.6, 0, 2, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1); // cisaillement, ligne z nulle
  racine.add(enfant);
  const singulier = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  enfant.add(singulier);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(NaN, 5, -0);
  enfant.add(petitEnfant);
  const nanMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  petitEnfant.add(nanMesh);
  const source = new THREE.Group();
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
  const associations = new Map<THREE.Mesh, { meshes: number; primitives: number }>([
    [singulier, { meshes: 0, primitives: 0 }],
    [nanMesh, { meshes: 1, primitives: 0 }],
  ]);
  const obtenu = exactPagesBounds(source, associations, metadata, () => {});
  const attendu = referenceExactPagesBounds(source, associations, metadata, () => {});
  assert.deepEqual(Array.from(obtenu), [...attendu.min.toArray(), ...attendu.max.toArray()]);
});

// Lot M4a : aucune allocation par page — un seul tampon de travail pour toute la boucle. Vérifié en
// repassant la même sortie `into` d’un appel à l’autre : c’est elle qui revient, jamais un objet neuf.
test('exactPagesBounds réutilise la sortie `into` au lieu d’en allouer une par page', () => {
  const geometry = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const source = new THREE.Group();
  source.add(mesh);
  const pages = Array.from({ length: 50 }, (_, i) => {
    const p = pageDe(i, `p/${i}`);
    p.min = [i, i, i];
    p.max = [i + 1, i + 1, i + 1];
    return p;
  });
  const metadata = { primitives: [{ mesh: 0, primitive: 0, pages }] } as unknown as ClusterManifest;
  const associations = new Map<THREE.Mesh, { meshes: number; primitives: number }>([
    [mesh, { meshes: 0, primitives: 0 }],
  ]);
  const into = emptyWorldBox();
  const rendu = exactPagesBounds(source, associations, metadata, () => {}, into);
  assert.equal(rendu, into, 'la même instance de tampon revient, quel que soit le nombre de pages');
});
