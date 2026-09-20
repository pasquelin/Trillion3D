import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix3UniformCache, setClusterSamplers } from './webglClusterUniforms.ts';

test('material constants cross the GL boundary only when their value changes', () => {
  const matrices: number[][] = [],
    samplers: Array<[string, number]> = [],
    gl = {
      uniformMatrix3fv: (_at: string, _transpose: boolean, value: Float32List) =>
        matrices.push([...value]),
      uniform1i: (at: string, value: number) => samplers.push([at, value]),
    } as unknown as WebGL2RenderingContext;
  const locations = (name: string) => name as unknown as WebGLUniformLocation;
  const cache = new Matrix3UniformCache(gl, locations);
  const identity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  cache.set('baseUv', identity);
  cache.set('baseUv', identity.slice());
  identity[6] = 0.25;
  cache.set('baseUv', identity);
  assert.deepEqual(matrices, [
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 0.25, 0, 1],
  ]);
  setClusterSamplers(gl, locations);
  assert.deepEqual(samplers, [
    ['baseMap', 0],
    ['roughMap', 1],
    ['metalMap', 2],
    ['normalMap', 3],
    ['aoMap', 4],
    ['emissiveMap', 5],
  ]);
});
