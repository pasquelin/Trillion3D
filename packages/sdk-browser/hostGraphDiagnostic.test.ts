import test from 'node:test';
import assert from 'node:assert/strict';
import { repaintHostGraph, type BeautyMaterials } from './hostGraphDiagnostic.ts';
import { hashId } from './diagnosticColors.ts';
import { triangleGeometry } from './triangleDiagnostic.ts';
import type {
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
  HostDiagnosticMesh,
  HostNode,
  HostTraversable,
} from './hostResources.ts';

/**
 * The repaint of an engine that declares no diagnostic: a host graph of the contract's shape
 * alone — no rendering library on either side — and a factory that records what it was asked
 * to build. What the view decides is what is asserted here.
 */
function hostMaterial(side: number, tag: string) {
  const material = {
    side,
    tag,
    disposed: false,
    clone: () => hostMaterial(side, `${tag}:clone`),
    dispose() {
      material.disposed = true;
    },
  };
  return material as unknown as HostDiagnosticMaterial & {
    tag: string;
    disposed: boolean;
  };
}
function hostGeometry(count: number, tag: string) {
  return {
    tag,
    attributes: { position: { count } },
    dispose() {},
  } as unknown as HostDiagnosticGeometry & { tag: string };
}
function hostMesh(id: number, material: HostDiagnosticMesh['material'], count = 6) {
  return {
    isMesh: true,
    id,
    material,
    geometry: hostGeometry(count, `g${id}`),
    userData: {} as Record<string, unknown>,
  } satisfies HostDiagnosticMesh;
}
function hostScene(...meshes: HostDiagnosticMesh[]): HostTraversable {
  const nodes = meshes as unknown as HostNode[];
  return {
    name: 'display',
    visible: true,
    traverse(visit) {
      for (const node of nodes) visit(node);
    },
  };
}
/** The tag a fake surface carries, whatever shape the mesh declares it in. */
const tagOf = (material: unknown) => (material as { tag: string }).tag;
const tagsOf = (material: unknown) => (material as { tag: string }[]).map((m) => m.tag);

function recordingFactory() {
  const asked: string[] = [];
  const host: HostDiagnosticFactory = {
    triangleGeometry(source) {
      asked.push(`geometry:${(source as unknown as { tag: string }).tag}`);
      return hostGeometry(source.attributes.position.count, 'expanded');
    },
    vertexColors(_geometry, colors) {
      asked.push(`colors:${colors.length}`);
    },
    triangleMaterial(side) {
      asked.push(`triangle:${side}`);
      return hostMaterial(side, 'triangle');
    },
    clusterMaterial(id, side) {
      asked.push(`cluster:${id}:${side}`);
      return hostMaterial(side, `cluster:${id}`);
    },
  };
  return { host, asked };
}

test('the repaint keeps the beauty surface of a mesh and hands it back on beauty', () => {
  const source = hostMaterial(1, 'source');
  const mesh = hostMesh(7, source);
  const beauty: BeautyMaterials = new Map();
  const overlays: HostDiagnosticMaterial[] = [];
  const { host } = recordingFactory();
  const sourceGeometry = mesh.geometry;
  repaintHostGraph(hostScene(mesh), 'clusters', host, beauty, overlays);
  assert.equal(beauty.get(mesh), source, 'the surface worn before any view is kept aside');
  assert.equal(mesh.userData.sourceGeometry, sourceGeometry);
  assert.notEqual(mesh.material, source);
  repaintHostGraph(hostScene(mesh), 'beauty', host, beauty, overlays);
  assert.equal(mesh.material, source, 'beauty gives the source surface back');
  assert.equal(mesh.geometry, sourceGeometry);
});

test('a node that is not a mesh is left alone', () => {
  const beauty: BeautyMaterials = new Map();
  const { host, asked } = recordingFactory();
  const plain = { name: 'group', visible: true } as HostNode;
  const scene: HostTraversable = { name: 'display', visible: true, traverse: (v) => v(plain) };
  repaintHostGraph(scene, 'clusters', host, beauty, []);
  assert.equal(beauty.size, 0);
  assert.deepEqual(asked, []);
});

test('the clusters view paints a cluster tint where the host declared one, a copy elsewhere', () => {
  const tinted = hostMesh(3, hostMaterial(2, 'tinted'));
  tinted.userData.clusterId = 'k12';
  const plain = hostMesh(4, hostMaterial(0, 'plain'));
  const overlays: HostDiagnosticMaterial[] = [];
  const { host, asked } = recordingFactory();
  repaintHostGraph(hostScene(tinted, plain), 'clusters', host, new Map(), overlays);
  assert.deepEqual(asked, ['cluster:k12:2']);
  assert.equal(tagOf(tinted.material), 'cluster:k12');
  assert.equal(tagOf(plain.material), 'plain:clone', 'no cluster: a copy');
  assert.equal(overlays.length, 2, 'both are the view’s to discard');
});

test('a mode that is not clusters copies the surface even where a cluster is declared', () => {
  const mesh = hostMesh(5, hostMaterial(0, 'surface'));
  mesh.userData.clusterId = 'k7';
  const { host, asked } = recordingFactory();
  repaintHostGraph(hostScene(mesh), 'pages', host, new Map(), []);
  assert.deepEqual(asked, [], 'no host material is built for a view that only copies');
  assert.equal(tagOf(mesh.material), 'surface:clone');
});

test('a surface declared per group stays a list, a single surface stays single', () => {
  const grouped = hostMesh(8, [hostMaterial(0, 'a'), hostMaterial(1, 'b')]);
  const single = hostMesh(9, hostMaterial(0, 'c'));
  const overlays: HostDiagnosticMaterial[] = [];
  repaintHostGraph(
    hostScene(grouped, single),
    'visibility',
    recordingFactory().host,
    new Map(),
    overlays,
  );
  assert.ok(Array.isArray(grouped.material));
  assert.deepEqual(tagsOf(grouped.material), ['a:clone', 'b:clone']);
  assert.equal(Array.isArray(single.material), false);
  assert.equal(overlays.length, 3);
});

test('the per-triangle view salts on the cluster the host declared, else on the mesh identity', () => {
  const withCluster = hostMesh(11, hostMaterial(2, 'w'));
  withCluster.userData.clusterId = 'p3';
  const withoutCluster = hostMesh(12, hostMaterial(0, 'n'));
  const { host, asked } = recordingFactory();
  const overlays: HostDiagnosticMaterial[] = [];
  repaintHostGraph(hostScene(withCluster, withoutCluster), 'wireframe', host, new Map(), overlays);
  assert.deepEqual(asked, [
    'geometry:g11',
    'colors:18',
    'triangle:2',
    'geometry:g12',
    'colors:18',
    'triangle:0',
  ]);
  assert.equal(
    withCluster.geometry,
    triangleGeometry(withCluster.userData.sourceGeometry as HostDiagnosticGeometry, host, 0),
    'the expanded copy is cached on the source geometry',
  );
  assert.notEqual(hashId('p3'), hashId('12'), 'the two salts are not the same number');
  assert.equal(tagOf(withCluster.material), 'triangle');
  assert.equal(overlays.length, 2);
});

test('a second view repaints the source surface, never the previous view’s copy', () => {
  const source = hostMaterial(0, 'source');
  const mesh = hostMesh(13, source);
  const beauty: BeautyMaterials = new Map();
  const { host } = recordingFactory();
  repaintHostGraph(hostScene(mesh), 'pages', host, beauty, []);
  const first = mesh.material;
  repaintHostGraph(hostScene(mesh), 'lod', host, beauty, []);
  assert.equal(tagOf(first), 'source:clone');
  assert.equal(tagOf(mesh.material), 'source:clone');
  assert.notEqual(mesh.material, first, 'a fresh copy of the source, not a copy of the copy');
});
