import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix3UniformCache, ModelUniforms, setClusterSamplers } from './uniforms.ts';

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
    ['backdrop', 6],
    ['backdropDepth', 7],
    ['ltcTable', 8],
    ['reflectionColor', 9],
    ['reflectionDepth', 10],
  ]);
});

// #840: sponza drew 1 465 pages twice a frame, each with the matrices the context already held.
test('the model matrices cross the GL boundary only when the drawn world matrix changes', () => {
  const sent: string[] = [],
    gl = {
      uniformMatrix4fv: (at: string) => sent.push(at),
      uniformMatrix3fv: (at: string) => sent.push(at),
    } as unknown as WebGL2RenderingContext;
  const at = (name: string) => name as unknown as WebGLUniformLocation;
  const model = new ModelUniforms(gl, at('modelView'), at('normal'));
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1],
    world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1];
  model.set(view, world);
  model.set(view, world.slice());
  assert.deepEqual(sent, ['modelView', 'normal'], 'a page of the same placement sends nothing');
  model.set(view, [...world.slice(0, 12), 3, 0, 0, 1]);
  assert.equal(sent.length, 4, 'another placement sends both');
  model.forget();
  model.set(view, [...world.slice(0, 12), 3, 0, 0, 1]);
  assert.equal(sent.length, 6, 'a new draw, whose view may have moved, sends them again');
});
