import { LINE_CLIP_GLSL, LINE_CLIP_WGSL } from '../visibility/shader/lineWgsl.ts'
import { GUIDE_CORNER_WGSL, GUIDE_CORNER_GLSL } from './guideCorner.ts'

/**
 * The guide program, in WGSL and in GLSL, one rule for both: every instance is a segment `a → b`
 * (a point is a segment of zero length) drawn as a quad `width` CSS pixels wide on the screen —
 * `width × pixelRatio` of the image's pixels, as every line of the engine counts it — capped half
 * a width past each end, so a dot is a square of that side. Its corners are the engine's line
 * corners (`lineClip`, `../visibility/shader/lineWgsl.ts`): a corner behind the near plane slides
 * onto it along the segment, in each engine's depth convention. Depth is the ends', interpolated:
 * the scene in front hides a guide, and the guide writes no depth of its own.
 */

/** Floats of the view uniform: the matrix, the viewport and the image's jitter in pixels, the
 *  pixel ratio, the size the scene depth was drawn at (padded to the uniform's sixteen bytes). */
export const GUIDE_UNIFORM_FLOATS = 24

/**
 * Writes the view uniform: `viewProjection` times the translation to `anchor`, in double
 * precision, so the instances' anchor-relative positions keep their detail far from the origin.
 * `pixelRatio` is the host's, read each frame, which a guide's CSS width is multiplied by.
 */
export function writeGuideView(
  into: Float32Array,
  viewProjection: ArrayLike<number>,
  anchor: ArrayLike<number>,
  width: number,
  height: number,
  pixelRatio: number,
  jitter: ArrayLike<number> = [0, 0],
  scene: ArrayLike<number> = [width, height],
) {
  for (let i = 0; i < 12; i++) into[i] = viewProjection[i]
  for (let r = 0; r < 4; r++)
    into[12 + r] =
      viewProjection[r] * anchor[0] +
      viewProjection[4 + r] * anchor[1] +
      viewProjection[8 + r] * anchor[2] +
      viewProjection[12 + r]
  into.set([width, height, jitter[0], jitter[1]], 16)
  into[20] = pixelRatio
  into[22] = scene[0]
  into[23] = scene[1]
  return into
}

export const GUIDE_WGSL = /* wgsl */ `
struct View { matrix: mat4x4f, viewport: vec4f, pixelRatio: f32, scene: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) color: vec4f };
${LINE_CLIP_WGSL}
${GUIDE_CORNER_WGSL}
@vertex fn vertexMain(@builtin(vertex_index) k: u32, @location(0) a: vec3f, @location(1) b: vec3f,
    @location(2) color: vec4f, @location(3) width: f32) -> Out {
  var corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  var out: Out;
  out.color = color;
  out.position = guideCorner(view.matrix * vec4f(a, 1.0), view.matrix * vec4f(b, 1.0), corners[k],
    width, view.viewport.xy, view.pixelRatio);
  return out;
}
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
fn sceneAt(p: vec2i) -> f32 {
  return textureLoad(sceneDepth, clamp(p, vec2i(0), vec2i(view.scene) - 1), 0);
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
// The guide draws at the display; the scene depth may be drawn below it, in the top-left
// \`view.scene\` of its target: its texel under the pixel.
@fragment fn fragmentMain(in: Out) -> @location(0) vec4f {
  let p = vec2i(floor(in.position.xy * (view.scene / view.viewport.xy)));
  let scene = sceneAt(p);
  if (in.position.z < scene - jitterSlack(p, scene)) { discard; }
  return in.color;
}
`

export const GUIDE_GLSL_VERTEX = /* glsl */ `#version 300 es
uniform mat4 matrix;
uniform vec4 viewport;
uniform float pixelRatio;
layout(location = 0) in vec3 a;
layout(location = 1) in vec3 b;
layout(location = 2) in vec4 color;
layout(location = 3) in float width;
out vec4 tint;
const vec2 CORNERS[6] = vec2[6](vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
  vec2(0.0, -1.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
${LINE_CLIP_GLSL}
${GUIDE_CORNER_GLSL}
void main() {
  tint = color;
  gl_Position = guideCorner(matrix * vec4(a, 1.0), matrix * vec4(b, 1.0), CORNERS[gl_VertexID % 6],
    width, viewport.xy, pixelRatio);
}`

export const GUIDE_GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec4 tint;
out vec4 colour;
void main() { colour = tint; }`
