// Arithmetic correctness of the production receiver projection, not an image or timing proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADING_POINT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/shadingPoint.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

const shader = `${SHADING_POINT_WGSL}
@group(0) @binding(0) var<storage,read_write> result:array<vec4f>;
@compute @workgroup_size(1) fn main(){
 let p0=vec3f(0.0);let p1=vec3f(2.0,0.0,0.0);let p2=vec3f(0.0,2.0,0.0);
 let P=vec3f(0.5,0.5,0.0);let b=vec3f(0.5,0.25,0.25);
 let n0=vec3f(0.0,0.0,1.0);let n1=vec3f(0.6,0.0,0.8);let n2=vec3f(0.0,0.6,0.8);
 result[0]=vec4f(shadingPointOffset(P,b,p0,p1,p2,n0,n1,n2),0.0);
 result[1]=vec4f(shadingPointOffset(P,b,p0,p1,p2,n0,n0,n0),0.0);
 result[2]=vec4f(shadingPointOffset(p1,vec3f(0.0,1.0,0.0),p0,p1,p2,n0,n1,n2),0.0);
 result[3]=vec4f(shadingPointOffset(P,b,p0,p1,p2,-n0,-n1,-n2),0.0);
 result[4]=vec4f(shadingPointOffset(P,b,p0,p1,p2,vec3f(0.0),vec3f(0.0),vec3f(0.0)),0.0);
}`;

async function project(source: string) {
  const opened = await globalThis.openGpuDevice();
  if (!opened) return { unavailable: true, values: [], errors: [] };
  const { device, errors } = opened;
  const { module, compilation } = await opened.compile(source);
  if (compilation.length) return { unavailable: false, values: [], errors: compilation };
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const values = await globalThis.computeReadback(device, pipeline, 80, 1);
  await opened.fermer();
  return { unavailable: false, values, errors };
}

if (import.meta.main)
  test('Phong projection preserves planes and vertices, curves the interior and is two-sided', async () => {
    const result = await dansPageWebgpu(project, shader, {
      titre: 'Receiver projection arithmetic',
    });
    assert.equal(result.unavailable, false);
    assert.deepEqual(result.errors, []);
    const expected = [0.135, 0.135, 0.36, 0];
    for (const at of [0, 12])
      expected.forEach((value, i) => assert.ok(Math.abs(result.values[at + i] - value) < 1e-6));
    for (const at of [4, 8, 16])
      assert.ok(result.values.slice(at, at + 4).every((value) => value === 0));
  });
