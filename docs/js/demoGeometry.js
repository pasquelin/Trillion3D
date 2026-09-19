/**
 * Geometry buffers and WGSL shader definitions for interactive demo.
 */

export const WGSL_SHADER = `
struct Uniforms { mvp: mat4x4<f32>, mode: u32, pad: vec3<u32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VertexIn { @location(0) pos: vec3<f32>, @location(1) n: vec3<f32>, @location(2) col: vec3<f32> };
struct VertexOut { @builtin(position) p: vec4<f32>, @location(0) col: vec3<f32>, @location(1) n: vec3<f32> };
@vertex fn vs(v: VertexIn) -> VertexOut {
  var o: VertexOut;
  o.p = u.mvp * vec4<f32>(v.pos, 1.0);
  o.col = select(v.col, abs(v.n), u.mode == 1u);
  o.n = v.n;
  return o;
}
@fragment fn fs(o: VertexOut) -> @location(0) vec4<f32> {
  let light = max(dot(normalize(o.n), normalize(vec3<f32>(0.5, 0.8, 0.6))), 0.2);
  return vec4<f32>(o.col * light, 1.0);
}
`;

export function buildCubeGeometry() {
  const p = [
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
    [-1, -1, -1],
    [-1, 1, -1],
    [1, 1, -1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, 1, 1],
    [1, 1, -1],
    [-1, -1, -1],
    [1, -1, -1],
    [1, -1, 1],
    [-1, -1, 1],
    [1, -1, -1],
    [1, 1, -1],
    [1, 1, 1],
    [1, -1, 1],
    [-1, -1, -1],
    [-1, -1, 1],
    [-1, 1, 1],
    [-1, 1, -1],
  ];
  const norms = [
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  const cols = [
    [0.9, 0.3, 0.3],
    [0.3, 0.7, 0.9],
    [0.3, 0.9, 0.4],
    [0.9, 0.8, 0.2],
    [0.8, 0.3, 0.9],
    [0.9, 0.5, 0.2],
  ];
  const verts = [];
  for (let f = 0; f < 6; f++) {
    const [nx, ny, nz] = norms[f];
    const [cr, cg, cb] = cols[f];
    const idxs = [0, 1, 2, 0, 2, 3];
    for (const i of idxs) {
      const [vx, vy, vz] = p[f * 4 + i];
      verts.push(vx * 0.8, vy * 0.8, vz * 0.8, nx, ny, nz, cr, cg, cb);
    }
  }
  return new Float32Array(verts);
}
