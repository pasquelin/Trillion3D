export const STEP_GLSL = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D source;
uniform vec4 physical;
uniform ivec2 shift;
out vec4 color;
vec3 cell(ivec2 at) {
  ivec2 n = textureSize(source, 0);
  if (any(lessThan(at, ivec2(0))) || any(greaterThanEqual(at, n))) return vec3(0);
  return texelFetch(source, at, 0).xyz;
}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  float dt = physical.x;
  vec3 middle = cell(at + shift);
  if (dt == 0.0) { color = vec4(middle, 0); return; }
  vec3 left = cell(at + ivec2(-1, 0)), right = cell(at + ivec2(1, 0));
  vec3 down = cell(at + ivec2(0, -1)), up = cell(at + ivec2(0, 1));
  float depth = physical.z, ratio = dt / physical.y;
  vec3 flux = vec3(depth * (right.y - left.y + up.z - down.z),
    9.81 * (right.x - left.x), 9.81 * (up.x - down.x));
  vec3 diffusion = 0.5 * sqrt(9.81 * depth) * ratio * (left + right + down + up - 4.0 * middle);
  color = vec4((middle - 0.5 * ratio * flux + diffusion) * physical.w, 0);
}`;
export const SPLAT_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 record;
uniform float extent;
out vec2 local;
out float strength;
void main() {
  vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),
    vec2(-1,1),vec2(1,-1),vec2(1,1));
  local = corners[gl_VertexID]; strength = record.w;
  vec2 world = record.xy + local * record.z;
  gl_Position = vec4(world * 2.0 / extent, 0, 1);
}`;
export const SPLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;
in float strength;
out vec4 color;
void main() {
  float weight = max(0.0, 1.0 - dot(local, local));
  color = vec4(strength * weight * weight, 0, 0, 0);
}`;
