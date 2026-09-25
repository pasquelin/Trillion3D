/**
 * The guide program, in WGSL and in GLSL, one rule for both: every instance is a segment `a → b`
 * (a point is a segment of zero length) drawn as a quad `width` pixels wide on the screen, capped
 * half a width past each end, so a dot is a square of that side. The segment is first cut at the
 * near plane — `near` is that plane in clip space, which each engine's depth convention names —
 * so an end behind the eye never flips the quad. Depth is the ends', interpolated: the scene in
 * front hides a guide, and the guide writes no depth of its own.
 */

/** Floats of the view uniform: the matrix, the viewport and the image's jitter in pixels, the
 *  near plane. */
export const GUIDE_UNIFORM_FLOATS = 24;

/** The clip-space near plane of the WebGPU engine's reversed depth (`z ≤ w`). */
export const REVERSED_NEAR_PLANE = [0, 0, -1, 1] as const;
/** The clip-space near plane of the WebGL2 host projection's forward depth (`z ≥ −w`). */
export const FORWARD_NEAR_PLANE = [0, 0, 1, 1] as const;

/**
 * Writes the view uniform: `viewProjection` times the translation to `anchor`, in double
 * precision, so the instances' anchor-relative positions keep their detail far from the origin.
 */
export function writeGuideView(
  into: Float32Array,
  viewProjection: ArrayLike<number>,
  anchor: ArrayLike<number>,
  width: number,
  height: number,
  near: readonly number[],
  jitter: ArrayLike<number> = [0, 0],
) {
  for (let i = 0; i < 12; i++) into[i] = viewProjection[i];
  for (let r = 0; r < 4; r++)
    into[12 + r] =
      viewProjection[r] * anchor[0] +
      viewProjection[4 + r] * anchor[1] +
      viewProjection[8 + r] * anchor[2] +
      viewProjection[12 + r];
  into.set([width, height, jitter[0], jitter[1]], 16);
  into.set(near, 20);
  return into;
}

/**
 * Depth slack of a guide at pixel `(x, y)` against the scene depth `depthAt`, the rule
 * `jitterSlack` applies in GUIDE_WGSL. The scene was drawn with this image's jitter `(jx, jy)`
 * pixels, the guide without it: the depth stored at a pixel is the surface's at `pixel − jitter`,
 * off by `∇d · j`, which `|jx|·|∂d/∂x| + |jy|·|∂d/∂y|` bounds — exactly on a plane, so a grid on
 * a floor or a box's edge neither shimmers nor half hides. Each slope is the smaller one-sided
 * difference: a silhouette beside the pixel opens no hole. No jitter, no slack.
 */
export function jitterDepthSlack(
  depthAt: (x: number, y: number) => number,
  x: number,
  y: number,
  jitter: ArrayLike<number>,
) {
  const centre = depthAt(x, y);
  const slope = (dx: number, dy: number) =>
    Math.min(
      Math.abs(depthAt(x + dx, y + dy) - centre),
      Math.abs(centre - depthAt(x - dx, y - dy)),
    );
  return Math.abs(jitter[0]) * slope(1, 0) + Math.abs(jitter[1]) * slope(0, 1);
}

export const GUIDE_WGSL = /* wgsl */ `
struct View { matrix: mat4x4f, viewport: vec4f, near: vec4f };
@group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vertexMain(@builtin(vertex_index) k: u32, @location(0) a: vec3f, @location(1) b: vec3f,
    @location(2) color: vec4f, @location(3) width: f32) -> Out {
  var corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  var ca = view.matrix * vec4f(a, 1.0);
  var cb = view.matrix * vec4f(b, 1.0);
  let da = dot(ca, view.near);
  let db = dot(cb, view.near);
  var out: Out;
  out.color = color;
  out.position = vec4f(2.0, 2.0, 0.0, 1.0);
  if (da < 0.0 && db < 0.0) { return out; }
  if (da < 0.0) { ca = mix(ca, cb, da / (da - db)); }
  if (db < 0.0) { cb = mix(cb, ca, db / (db - da)); }
  let half = view.viewport.xy * 0.5;
  let sa = ca.xy / ca.w * half;
  let sb = cb.xy / cb.w * half;
  let len = length(sb - sa);
  let dir = select(vec2f(1.0, 0.0), (sb - sa) / max(len, 1e-6), len > 1e-4);
  let corner = corners[k];
  let c = select(ca, cb, corner.x > 0.5);
  let offset = (vec2f(-dir.y, dir.x) * corner.y + dir * (corner.x * 2.0 - 1.0)) * width * 0.5;
  out.position = vec4f(c.xy + offset / half * c.w, c.zw);
  return out;
}
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
fn sceneAt(p: vec2i) -> f32 {
  return textureLoad(sceneDepth, clamp(p, vec2i(0), vec2i(textureDimensions(sceneDepth)) - 1), 0);
}
fn slopeAlong(p: vec2i, axis: vec2i, centre: f32) -> f32 {
  return min(abs(sceneAt(p + axis) - centre), abs(centre - sceneAt(p - axis)));
}
// The rule of jitterDepthSlack: the scene depth is off by at most the jitter times its slope.
fn jitterSlack(p: vec2i, centre: f32) -> f32 {
  return abs(view.viewport.z) * slopeAlong(p, vec2i(1, 0), centre)
    + abs(view.viewport.w) * slopeAlong(p, vec2i(0, 1), centre);
}
// Reversed depth: the greater is nearer; the scene in front, beyond the slack, hides the guide.
@fragment fn fragmentMain(in: Out) -> @location(0) vec4f {
  let p = vec2i(floor(in.position.xy));
  let scene = sceneAt(p);
  if (in.position.z < scene - jitterSlack(p, scene)) { discard; }
  return in.color;
}
`;

export const GUIDE_GLSL_VERTEX = /* glsl */ `#version 300 es
uniform mat4 matrix;
uniform vec4 viewport;
uniform vec4 nearPlane;
layout(location = 0) in vec3 a;
layout(location = 1) in vec3 b;
layout(location = 2) in vec4 color;
layout(location = 3) in float width;
out vec4 tint;
const vec2 CORNERS[6] = vec2[6](vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
  vec2(0.0, -1.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
void main() {
  vec4 ca = matrix * vec4(a, 1.0);
  vec4 cb = matrix * vec4(b, 1.0);
  float da = dot(ca, nearPlane);
  float db = dot(cb, nearPlane);
  tint = color;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  if (da < 0.0 && db < 0.0) return;
  if (da < 0.0) ca = mix(ca, cb, da / (da - db));
  if (db < 0.0) cb = mix(cb, ca, db / (db - da));
  vec2 half_ = viewport.xy * 0.5;
  vec2 sa = ca.xy / ca.w * half_;
  vec2 sb = cb.xy / cb.w * half_;
  float len = length(sb - sa);
  vec2 dir = len > 1e-4 ? (sb - sa) / len : vec2(1.0, 0.0);
  vec2 corner = CORNERS[gl_VertexID % 6];
  vec4 c = corner.x > 0.5 ? cb : ca;
  vec2 offset = (vec2(-dir.y, dir.x) * corner.y + dir * (corner.x * 2.0 - 1.0)) * width * 0.5;
  gl_Position = vec4(c.xy + offset / half_ * c.w, c.zw);
}`;

export const GUIDE_GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec4 tint;
out vec4 colour;
void main() { colour = tint; }`;
