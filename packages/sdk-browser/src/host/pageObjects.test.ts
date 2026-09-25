// #78 lot 3: the autonomous WebGL2 path holds its scene, meshes, geometries and surfaces through
// the shapes of `resources.ts`, and this boundary is what builds them. The host brands the
// objects its renderer accepts — `Object3D.add` drops any node without `isObject3D`, silently,
// and a mesh dropped there is a page that leaves the image without an error — so the test hangs
// what the boundary built on a REAL host scene and reads the graph back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './graph/graph.fixture.ts';
import {
  colouredHostSurface,
  hostPageBytes,
  hostPageGeometry,
  hostPageMesh,
  hostPageScene,
  hostPageSurface,
  releaseHostGeometry,
  setHostPose,
  setHostSurface,
} from './pageObjects.ts';
import type { Material } from '../../../sdk-core/src/index.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';

const CONTRACT: Material = {
  baseColor: [0.25, 0.5, 0.75],
  opacity: 0.5,
  metalness: 0.125,
  roughness: 0.875,
  emissive: [0, 1, 0],
  side: 'double',
  alphaMode: 'mask',
  alphaCutoff: 0.4,
};

/** One triangle, decoded: three positions, three UVs, and a colour on each corner. */
const page = (): DecodedGeometryPage => ({
  indices: new Uint32Array([0, 1, 2]),
  attributes: {
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
    color: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
  },
  vertexCount: 3,
  flags: 0,
  decodedBytes: 0,
  quantizationError: 0,
});
const itemSize = (name: string) => ({ position: 3, color: 4 })[name] ?? 2;

test('a page mesh built here is a node the host graph accepts, posed and ordered as asked', () => {
  const scene = hostPageScene();
  const geometry = hostPageGeometry(page(), itemSize, [0, 0, 0], [1, 1, 0]);
  const declaration = hostPageSurface(CONTRACT, false);
  const mesh = hostPageMesh(geometry, declaration, 7);
  scene.add(mesh);
  const [drawn] = scene.children as unknown as G.GraphMesh[];
  assert.equal(drawn, mesh as unknown as G.GraphMesh, 'the host kept the node it was given');
  assert.equal(drawn.material, declaration);
  assert.equal(drawn.renderOrder, 7);
  assert.equal(drawn.matrixAutoUpdate, false, 'the pose is written, never recomposed');
  assert.equal(drawn.frustumCulled, false, 'the cut has already decided what is drawn');
  const pose = new G.Matrix4().makeTranslation(1, 2, 3);
  setHostPose(mesh, pose);
  assert.deepEqual(drawn.matrix.toArray(), pose.toArray());
  const repaint = hostPageSurface({ ...CONTRACT, alphaMode: 'opaque' }, true);
  setHostSurface(mesh, repaint);
  assert.equal(drawn.material, repaint);
  scene.remove(mesh);
  assert.equal(scene.children.length, 0);
  releaseHostGeometry(geometry);
});

test('a page geometry carries the box the page declares, its index and its component counts', () => {
  const geometry = hostPageGeometry(page(), itemSize, [0, 0, -1], [1, 1, 2]);
  const host = geometry as unknown as G.Geometry;
  assert.deepEqual(host.getIndex()!.array, new Uint32Array([0, 1, 2]));
  assert.deepEqual(
    [geometry.attributes.position.itemSize, geometry.attributes.uv.itemSize],
    [3, 2],
    'anything the engine does not name is a UV pair',
  );
  assert.equal(geometry.attributes.color.itemSize, 4);
  // The box is the page's own: a quantized position reaches it only to the page's error, so
  // taking the box from the decoded corners would shrink it image after image.
  assert.deepEqual(
    [host.boundingBox!.min.toArray(), host.boundingBox!.max.toArray()],
    [
      [0, 0, -1],
      [1, 1, 2],
    ],
  );
  assert.equal(host.boundingSphere!.radius > 0, true);
  assert.equal(hostPageBytes(geometry), 12 + 36 + 24 + 48, 'index and every attribute, once');
  releaseHostGeometry(geometry);
});

test('a surface built from the contract declares the host side, the cutoff and the twin', () => {
  const surface = hostPageSurface(CONTRACT, false);
  const host = surface as unknown as G.GraphSurface;
  assert.equal(host.side, G.DOUBLE_SIDE);
  assert.equal(host.alphaTest, 0.4, 'a masked surface carries its cutoff');
  assert.equal(host.transparent, false, 'masking is not blending');
  assert.deepEqual((host.color as G.Color).toArray(), [0.25, 0.5, 0.75]);
  assert.deepEqual([host.metalness, host.roughness, host.opacity], [0.125, 0.875, 0.5]);
  assert.equal(host.vertexColors, false);
  const blended = hostPageSurface({ ...CONTRACT, alphaMode: 'blend' }, false);
  assert.equal((blended as unknown as G.GraphSurface).transparent, true);
  assert.equal((blended as unknown as G.GraphSurface).alphaTest, 0);
  const twin = colouredHostSurface(surface);
  assert.notEqual(twin, surface, 'the twin is a copy: the plain surface keeps its own state');
  assert.equal((twin as unknown as G.GraphSurface).vertexColors, true);
  assert.equal(host.vertexColors, false);
});
