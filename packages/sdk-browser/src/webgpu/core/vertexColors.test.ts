// #347: WebGPU drew white where a material asks for vertex colours. The colours of the geometry
// read as floats ride at the tail of the normal buffer; these tests read that buffer as uploaded
// and index it the way the shader's `vertColor` does.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { fakeDevice, written, type FakeWrite } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { prepareWebgpuGeometry } from './geometryPrepare.ts';
import { VERTEX_COLOR_WGSL } from './vertexColors.ts';
import { ensureBlendNormalBuffer } from '../blend/buffers.ts';
import { createWebgpuGpuState } from '../pages/state/gpu.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import type { HostAttributes } from '../../host/resources.ts';
import { surfaceOf } from '../../page/surface.ts';
import { FLAG_HAS_COLOR } from '../../visibility/types.ts';
import { prepareWebgpuBlend } from '../blend/prepare.ts';
import { BLEND_SHADER } from '../blend/shader.ts';
import { createWebgpuBlendState } from '../blend/state.ts';

/** `vertColor(id)` of the shader, on the floats of a bound normal buffer. */
function vertColor(normals: Float32Array, id: number) {
  const i = Math.floor(normals.length / 11) * 7 + id * 4;
  return Array.from(normals.subarray(i, i + 4));
}

const floats = (write: FakeWrite) => new Float32Array(written(write).slice().buffer);

function triangleGeometry(colour?: number[], itemSize = 3, normal = true) {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  if (normal) geometry.setAttribute('normal', G.floatAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  if (colour) geometry.setAttribute('color', G.floatAttribute(colour, itemSize));
  geometry.setIndex(G.indices([0, 1, 2]));
  return geometry;
}
const triangle = (colour?: number[], itemSize = 3, normal = true) =>
  triangleGeometry(colour, itemSize, normal).attributes as HostAttributes;

test('the shader finds the colour tail from the buffer length, as the test mirror does', () => {
  assert.match(VERTEX_COLOR_WGSL, /let i=arrayLength\(&normals\)\/11u\*7u\+id\*4u;/);
});

test('the source geometry of a scene carries its vertex colours at the tail of its normals', () => {
  const { device, writes } = fakeDevice();
  const plain = triangle(),
    coloured = triangle([1, 0, 0, 0, 1, 0, 0, 0.5, 1]);
  const pages = [{ attributes: plain }, { attributes: coloured }] as PageRec[];
  const blocks = new Map<HostAttributes, GeometryBlock>();
  prepareWebgpuGeometry(device, pages, blocks);
  const normals = floats(writes[2]);
  assert.equal(normals.length, 6 * 11);
  assert.equal(blocks.get(plain)!.hasColor, false);
  const block = blocks.get(coloured)!;
  assert.equal(block.hasColor, true);
  // A three-component colour reads an alpha of one; the normals before the tail did not move.
  assert.deepEqual(vertColor(normals, block.vertexBase), [1, 0, 0, 1]);
  assert.deepEqual(vertColor(normals, block.vertexBase + 2), [0, 0.5, 1, 1]);
  assert.deepEqual(
    Array.from(normals.subarray(block.vertexBase * 7, block.vertexBase * 7 + 3)),
    [0, 0, 1],
  );
});

test('a scene without vertex colours uploads the normal buffer it always did', () => {
  const { device, writes } = fakeDevice();
  prepareWebgpuGeometry(device, [{ attributes: triangle() }] as PageRec[], new Map());
  assert.equal(floats(writes[2]).length, 3 * 7);
});

test('a transparent geometry carries its colours, alpha included, even without a normal', () => {
  const { device, writes } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  ensureBlendNormalBuffer(device, triangle([1, 0, 0, 0.25, 0, 1, 0, 1, 0, 0, 1, 0.5], 4), gpu);
  const normals = floats(writes[0]);
  assert.equal(normals.length, 3 * 11);
  assert.deepEqual(vertColor(normals, 0), [1, 0, 0, 0.25]);
  assert.deepEqual(vertColor(normals, 2), [0, 0, 1, 0.5]);
  ensureBlendNormalBuffer(device, triangle([1, 1, 0, 1, 1, 0, 1, 1, 0], 3, false), gpu);
  assert.deepEqual(vertColor(floats(writes[1]), 1), [1, 1, 0, 1]);
  ensureBlendNormalBuffer(device, triangle(), gpu);
  assert.equal(floats(writes[2]).length, 3 * 7, 'no colour, no tail');
});

test('a transparent item multiplies its colour by the vertex colour when its material asks', () => {
  const { device } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  const blendState = createWebgpuBlendState();
  const copy = (vertexColors: boolean, colour?: number[]) => {
    const material = G.standardSurface({ transparent: true, opacity: 0.5, vertexColors });
    const mesh = G.mesh(triangleGeometry(colour), material);
    return Object.assign(mesh, { surface: surfaceOf(material) });
  };
  const red = [1, 0, 0, 1, 0, 0, 1, 0, 0];
  const copies = [copy(true, red), copy(false, red), copy(true)];
  prepareWebgpuBlend(device, copies, gpu, blendState, new G.GraphScene());
  const coloured = blendState.blendGpu.map((item) => (item.flags & FLAG_HAS_COLOR) !== 0);
  assert.deepEqual(coloured, [true, false, false]);
  // The vertex stage multiplies the item colour, alpha included, at the vertex it fetched.
  const stage = BLEND_SHADER.slice(BLEND_SHADER.indexOf('@vertex fn vs'));
  const fetch = stage.indexOf('let id=it.vertexBase+indices[base+local];');
  const multiply = stage.indexOf(`if((flags&${FLAG_HAS_COLOR}u)!=0u){out.color*=vertColor(id);}`);
  assert.ok(fetch > 0 && multiply > fetch);
  assert.ok(BLEND_SHADER.includes(VERTEX_COLOR_WGSL));
});
