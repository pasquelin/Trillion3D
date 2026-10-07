// The shadow receiver's Phong projection on the GPU (`shadingPoint.ts`): the shipped WGSL run on
// one triangle, its arithmetic read back.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/shading-point.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOnDawn } from '../kit/computeRun.ts'
import { SHADING_POINT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/shadingPoint.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'

// One triangle in the z = 0 plane, its normals tilted outward (a convex patch seen from +z).
const SHADER = wgslProgram(
  `@group(0) @binding(0) var<storage,read_write> result:array<vec4f>;
@compute @workgroup_size(1) fn main(){
 let p0=vec3f(0.0);let p1=vec3f(2.0,0.0,0.0);let p2=vec3f(0.0,2.0,0.0);
 let P=vec3f(0.5,0.5,0.0);let b=vec3f(0.5,0.25,0.25);
 let n0=vec3f(0.0,0.0,1.0);let n1=vec3f(0.6,0.0,0.8);let n2=vec3f(0.0,0.6,0.8);
 result[0]=vec4f(shadingPointOffset(P,b,p0,p1,p2,n0,n1,n2),0.0);
 result[1]=vec4f(shadingPointOffset(P,b,p0,p1,p2,n0,n0,n0),0.0);
 result[2]=vec4f(shadingPointOffset(p1,vec3f(0.0,1.0,0.0),p0,p1,p2,n0,n1,n2),0.0);
 result[3]=vec4f(shadingPointOffset(P,b,p0,p1,p2,-n0,-n1,-n2),0.0);
 result[4]=vec4f(shadingPointOffset(P,b,p0,p1,p2,vec3f(0.0),vec3f(0.0),vec3f(0.0)),0.0);
}`,
  [SHADING_POINT_WGSL],
)

test('the projection keeps planes and vertices, curves the interior, rises on its lit side only', async () => {
  const { values, errors } = await computeOnDawn(SHADER, 80)
  assert.deepEqual(errors, [])
  const offset = (row: number) => values.slice(row * 4, row * 4 + 3)
  const none = (row: number) => offset(row).every((value) => value === 0)
  // The convex patch: the point rises off its triangle by the sum of its offsets from each
  // vertex's tangent plane, (0.135, 0.135, 0.36) — written out by hand from the three planes.
  offset(0).forEach((value, i) => assert.ok(Math.abs(value - [0.135, 0.135, 0.36][i]) < 1e-6))
  // A flat patch, a vertex, and normals that carry no side: the point stays on its triangle.
  for (const row of [1, 2, 4]) assert.ok(none(row), `row ${row}: ${offset(row)}`)
  // The same patch with its normals turned: the projection falls behind the side they
  // face — under the surface a caster drew, which would shadow the pixel with its own depth —,
  // so the receiver keeps the triangle's point.
  assert.ok(none(3), `turned normals: the receiver keeps its triangle, not ${offset(3)}`)
})
