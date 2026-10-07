import { matrixAtRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'
import { GUIDE_CORNER_WGSL } from './guideCorner.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/**
 * The guide program: every instance is a segment `a → b` (a point is a segment of zero length)
 * drawn as a quad `width` CSS pixels wide on the screen — `width × pixelRatio` of the image's
 * pixels, as every line of the engine counts it — capped half a width past each end, so a dot is a
 * square of that side. Its corners are the engine's line
 * corners (`lineClip`, `../visibility/shader/lineWgsl.ts`): a corner behind the near plane slides
 * onto it along the segment, in the engine's reversed depth. Depth is the ends', interpolated:
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
  matrixAtRenderOrigin(into, viewProjection, anchor)
  into.set([width, height, jitter[0], jitter[1]], 16)
  into[20] = pixelRatio
  into[22] = scene[0]
  into[23] = scene[1]
  return into
}

export const GUIDE_WGSL = wgslProgram(
  `
struct View { matrix: mat4x4f, viewport: vec4f, pixelRatio: f32, scene: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct Out { @builtin(position) position: vec4f, @location(0) color: vec4f };
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
`,
  [GUIDE_CORNER_WGSL],
)
