// What a bake reads: its bindings, the scene's records, the constant tables, a shell triangle's
// frame and an atlas texel's place on it.

struct Params {
    first: u32,
    count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> scene: array<vec4u>;
@group(0) @binding(2) var<storage, read> materials: array<vec4u>;
@group(0) @binding(3) var<storage, read> texels: array<vec4u>;
@group(0) @binding(4) var<storage, read_write> results: array<vec4u>;

// The scene's bases: frames, nodes, corners, attributes.
fn bases() -> vec4u {
    return materials[1];
}

fn table(at: u32) -> f32 {
    let i = TABLES * 4u + at;
    return bitcast<f32>(materials[i / 4u][i % 4u]);
}

fn bary(a: vec3f, b: vec3f, c: vec3f, w: vec3f) -> vec3f {
    return a * w.x + b * w.y + c * w.z;
}

// A shell triangle: its corners, corner normals and corner tangents, each with its bitangent's
// sign.
struct Frame {
    c0: vec3f,
    c1: vec3f,
    c2: vec3f,
    n0: vec3f,
    n1: vec3f,
    n2: vec3f,
    t0: vec4f,
    t1: vec4f,
    t2: vec4f,
}

fn frame_of(t: u32) -> Frame {
    let at = bases().x + t * FRAME_RECORDS;
    return Frame(f4(at).xyz, f4(at + 1u).xyz, f4(at + 2u).xyz, f4(at + 3u).xyz, f4(at + 4u).xyz,
        f4(at + 5u).xyz, f4(at + 6u), f4(at + 7u), f4(at + 8u));
}

// A corner's bitangent: its normal crossed with its tangent, turned by the tangent's sign, unit.
fn bitangent(n: vec3f, t: vec4f) -> vec3f {
    return normalized_or(cross(n, t.xyz) * t.w, vec3f(0.0));
}

// A texel: its point on its shell triangle, the triangle's normal there, and its tangent frame:
// the corners' tangents blended and made unit, their bitangents blended and made unit — the frame
// the engine reads from the tangents the shell's pages store.
struct Texel {
    p: vec3f,
    n: vec3f,
    frame: mat2x3f,
}

fn texel_of(i: u32) -> Texel {
    let s = texels[i];
    let f = frame_of(s.y);
    let w = weights(vec2f(bitcast<f32>(s.z), bitcast<f32>(s.w)));
    let n = normalized_or(bary(f.n0, f.n1, f.n2, w), vec3f(0.0, 1.0, 0.0));
    let t = normalized_or(bary(f.t0.xyz, f.t1.xyz, f.t2.xyz, w), vec3f(0.0));
    let b = bary(bitangent(f.n0, f.t0), bitangent(f.n1, f.t1), bitangent(f.n2, f.t2), w);
    return Texel(bary(f.c0, f.c1, f.c2, w), n, mat2x3f(t, normalized_or(b, vec3f(0.0))));
}
