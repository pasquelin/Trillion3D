/**
 * The hardware benchmark's programs (`gpuBenchmark.ts`): the rectangle every pixel test draws, the
 * two vertex tests, the five pixel tests and the one that writes nothing, and the long pass that
 * brings the device's clocks up before the timed passes.
 */
export const BENCHMARK_WGSL = /* wgsl */ `
struct Rectangle {
  // Rows of the 512² target the rectangle covers, from the top.
  height: f32,
}

@group(0) @binding(0) var<uniform> rectangle: Rectangle;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var pointClamp: sampler;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

const SIDE: f32 = 512.0;

// The rectangle of the pixel tests: two triangles over the top rows, their coordinates the rows'.
@vertex
fn rectangleVertex(@builtin(vertex_index) index: u32) -> Varyings {
  var corners = array(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
  );
  let pixel = corners[index] * vec2f(SIDE, rectangle.height);
  var out: Varyings;
  out.position = vec4f(-1.0 + 2.0 * pixel.x / SIDE, 1.0 - 2.0 * pixel.y / SIDE, 0.0, 1.0);
  out.uv = pixel / SIDE;
  return out;
}

// The first vertex test: five attributes read and summed; the position's w is 0, nothing is drawn.
@vertex
fn attributesVertex(
  @location(0) a0: vec4f,
  @location(1) a1: vec4f,
  @location(2) a2: vec4f,
  @location(3) a3: vec4f,
  @location(4) a4: vec4f,
) -> Varyings {
  var out: Varyings;
  out.position = a0 + a1 + a2 + a3 + a4;
  out.uv = vec2f(0.0);
  return out;
}

// The second vertex test: the vertex's index alone; nothing is drawn.
@vertex
fn vertexIdVertex(@builtin(vertex_index) index: u32) -> Varyings {
  var out: Varyings;
  out.position = vec4f(f32(index), 0.0, 0.0, 0.0);
  out.uv = vec2f(0.0);
  return out;
}

// A position's noise, all arithmetic: it repeats every 128 units.
fn pseudoRandom(xy: vec2f) -> f32 {
  let pos = fract(xy / 128.0) * 128.0 + vec2f(-64.340622, -72.465622);
  return fract(dot(pos.xyx * pos.xyy, vec3f(20.390625, 60.703125, 2.4281209)));
}

// Arithmetic: one read, sixteen noises.
@fragment
fn aluNoiseFragment(v: Varyings) -> @location(0) vec4f {
  var color = textureSample(source, pointClamp, v.uv) * 0.99;
  for (var i = 0; i < 16; i++) {
    color.r += pseudoRandom(v.uv + vec2f(f32(i) * 0.001, 0.0));
  }
  return color;
}

// Texture reads: sixteen, side by side.
@fragment
fn textureFragment(v: Varyings) -> @location(0) vec4f {
  var color = vec4f(0.0);
  for (var i = 0; i < 16; i++) {
    color.r += textureSample(source, pointClamp, v.uv + vec2f(f32(i) * 0.0001, 0.0)).r;
  }
  return color;
}

// Dependent texture reads: each one's place depends on the sum so far.
@fragment
fn dependentTextureFragment(v: Varyings) -> @location(0) vec4f {
  var color = vec4f(0.0);
  for (var i = 0; i < 16; i++) {
    color.r += textureSample(source, pointClamp, v.uv + vec2f(f32(i) * 0.001, color.r * 0.001)).r;
  }
  return color;
}

// Fill: one read, one write.
@fragment
fn fillFragment(v: Varyings) -> @location(0) vec4f {
  return textureSample(source, pointClamp, v.uv) * 0.99;
}

// Bandwidth: sixteen reads 16 texels apart, scattered over the whole target.
@fragment
fn bandwidthFragment(v: Varyings) -> @location(0) vec4f {
  var color = vec4f(0.0);
  let pixel = fract(v.uv * SIDE / 16.0) * 16.0;
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      color.r += textureSample(source, pointClamp, (pixel + vec2f(f32(x), f32(y))) * 16.0 / SIDE).r;
    }
  }
  return color;
}

// The vertex tests' pixels: none is reached, black.
@fragment
fn blackFragment(v: Varyings) -> @location(0) vec4f {
  return vec4f(0.0);
}

// The long pass: a full-screen strip, each pixel twelve hundred sines and cosines.
@vertex
fn longVertex(@location(0) position: vec4f) -> @builtin(position) vec4f {
  return vec4f(position.xy, 0.0, 1.0);
}

@fragment
fn longFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  var color = vec4f(0.0);
  for (var i = 0; i < 1200; i++) {
    color += 0.0001 * cos(position.x) * sin(position.y);
  }
  return color * 0.000001;
}
`
