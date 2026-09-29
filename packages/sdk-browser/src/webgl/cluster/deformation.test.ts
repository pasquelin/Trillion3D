import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterDeformation } from './deformation.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import type { ClusterDraw } from '../../cluster/batchMesh.ts';

test('oversized deformation streams are refused before creating a source texture', () => {
  let textures = 0;
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    getParameter: () => 1024,
    activeTexture() {},
    bindTexture() {},
    texParameteri() {},
    texImage2D() {},
    texSubImage2D() {},
    createTexture() {
      textures++;
      return {};
    },
  } as unknown as WebGL2RenderingContext;
  const deformation = new WebglClusterDeformation(gl);
  assert.equal(textures, 0, 'undeformed scenes allocate no control texture');
  deformation.beginFrame({ block: new Float32Array(8), bases: new Uint32Array([1]), version: 0 });
  const source = new Geometry();
  const vertices = (1024 * 1024) / 4 + 1;
  source.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  source.setAttribute('skinIndex', new BufferAttribute(new Float32Array(vertices * 4), 4));
  source.setAttribute('skinWeight', new BufferAttribute(new Float32Array(vertices * 4), 4));
  assert.throws(
    () => deformation.of({ deformRecord: 1 } as unknown as ClusterDraw, source, new Int32Array(3)),
    /deformation texels exceed/,
  );
  assert.equal(textures, 1, 'the invalid source texture was never allocated');
});

test('source textures allocate padded rows once and release with their geometry', () => {
  const allocations: number[] = [],
    deleted: object[] = [];
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    getParameter: () => 2048,
    activeTexture() {},
    bindTexture() {},
    texParameteri() {},
    texSubImage2D() {},
    texImage2D(_target: number, _level: number, _format: number, width: number, height: number) {
      allocations.push(width * height * 16);
    },
    createTexture() {
      return {};
    },
    deleteTexture(texture: object) {
      deleted.push(texture);
    },
  } as unknown as WebGL2RenderingContext;
  const deformation = new WebglClusterDeformation(gl);
  const controls = { block: new Float32Array(8), bases: new Uint32Array([1]), version: 0 };
  deformation.beginFrame(controls);
  const source = new Geometry();
  source.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  source.setAttribute('morph', new BufferAttribute(new Float32Array(18), 6));
  const draw = { deformRecord: 1 } as unknown as ClusterDraw;
  deformation.of(draw, source, new Int32Array(3));
  deformation.of(draw, source, new Int32Array(3));
  deformation.beginFrame(controls);
  assert.deepEqual(allocations, [16384, 16384], 'one control row and one source row');
  source.dispose();
  assert.equal(deleted.length, 1, 'geometry eviction releases its source texture');
  deformation.dispose();
  assert.equal(deleted.length, 2, 'session disposal releases the control texture exactly once');
});
