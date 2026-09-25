import { LINE_CLIP_GLSL, LINE_CLIP_WGSL } from '../visibility/shader/lineWgsl.ts';

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
 *  pixel ratio (padded to the uniform's sixteen-byte size). */
export const GUIDE_UNIFORM_FLOATS = 24;

/**
 * A corner of a guide's quad, `corner` naming its end (`x`: 0 at `a`, 1 at `b`) and its side
 * (`y`: ±1), in clip space. `lineClip` moves it off the segment by half the width; a second
 * `lineClip`, along that offset, moves it half a width past its end — the cap. A dot has no
 * screen direction of its own: it runs along the screen's `x` axis, and its quad is a square. Each
 * end is first put on the near plane (`lineClip` at no width): a segment whose two ends both slid
 * there lies wholly behind it and keeps no width, so its caps draw no square either.
 */
export const GUIDE_CORNER_WGSL = `fn guideCorner(ca:vec4f,cb:vec4f,corner:vec2f,width:f32,viewport:vec2f,pixelRatio:f32)->vec4f{
 let run=select(cb-ca,vec4f(1.0,0.0,0.0,0.0),length(cb-ca)==0.0);
 let na=lineClip(ca,run,0.0,viewport,pixelRatio);
 let nb=lineClip(cb,run,0.0,viewport,pixelRatio);
 let shown=select(width,0.0,length(na-ca)>0.0&&length(nb-cb)>0.0);
 let onPlane=select(na,nb,corner.x>0.5);
 let side=lineClip(select(ca,cb,corner.x>0.5),run*corner.y,shown,viewport,pixelRatio);
 return lineClip(side,(side-onPlane)*(corner.y*(1.0-2.0*corner.x)),shown,viewport,pixelRatio);
}`;

/** The same corner in the WebGL2 program, over `LINE_CLIP_GLSL`'s forward depth. */
export const GUIDE_CORNER_GLSL = `vec4 guideCorner(vec4 ca,vec4 cb,vec2 corner,float width,vec2 viewport,float pixelRatio){
 vec4 run=length(cb-ca)==0.0?vec4(1.0,0.0,0.0,0.0):cb-ca;
 vec4 na=lineClip(ca,run,0.0,viewport,pixelRatio);
 vec4 nb=lineClip(cb,run,0.0,viewport,pixelRatio);
 float shown=length(na-ca)>0.0&&length(nb-cb)>0.0?0.0:width;
 vec4 onPlane=corner.x>0.5?nb:na;
 vec4 side=lineClip(corner.x>0.5?cb:ca,run*corner.y,shown,viewport,pixelRatio);
 return lineClip(side,(side-onPlane)*(corner.y*(1.0-2.0*corner.x)),shown,viewport,pixelRatio);
}`;

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
) {
  for (let i = 0; i < 12; i++) into[i] = viewProjection[i];
  for (let r = 0; r < 4; r++)
    into[12 + r] =
      viewProjection[r] * anchor[0] +
      viewProjection[4 + r] * anchor[1] +
      viewProjection[8 + r] * anchor[2] +
      viewProjection[12 + r];
  into.set([width, height, jitter[0], jitter[1]], 16);
  into[20] = pixelRatio;
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
struct View { matrix: mat4x4f, viewport: vec4f, pixelRatio: f32 };
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
}`;

export const GUIDE_GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec4 tint;
out vec4 colour;
void main() { colour = tint; }`;
