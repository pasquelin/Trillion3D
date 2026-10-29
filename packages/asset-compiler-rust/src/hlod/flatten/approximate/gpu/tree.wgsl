// The shell's queries: one point per invocation, its value written at its own rank — no order
// between invocations reaches the values. The scene's records, the head first (`layout.rs`); a
// triangle's corners about the scene's centre; the walks' shared geometry.

struct Params {
    first: u32,
    count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> scene: array<vec4u>;
@group(0) @binding(2) var<storage, read> points: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> values: array<vec2u>;

// A query's result: its value's bits, then 1 when the walk stopped early, else 0.
fn result(value: f32, stopped: bool) -> vec2u {
    return vec2u(bitcast<u32>(value), select(0u, 1u, stopped));
}

// The three corners of the triangle whose first record is `at`.
struct Triangle {
    a: vec3f,
    b: vec3f,
    c: vec3f,
}

fn triangle_at(at: u32) -> Triangle {
    return Triangle(f4(at).xyz, f4(at + 1u).xyz, f4(at + 2u).xyz);
}

// The squared distance from `p` to the box `low`, `high`.
fn box_distance2(low: vec3f, high: vec3f, p: vec3f) -> f32 {
    let out = max(max(low - p, p - high), vec3f(0.0));
    return dot(out, out);
}

fn holds(low: vec3f, high: vec3f, p: vec3f) -> bool {
    return all(p >= low) && all(p <= high);
}

// The squared distance from `p` to triangle `t`: to the plane's foot inside it, else to the nearest
// point of the corner or edge whose region holds the point, by its barycentric signs.
fn triangle_distance2(t: Triangle, p: vec3f) -> f32 {
    let ab = t.b - t.a;
    let ac = t.c - t.a;
    let ap = p - t.a;
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return dot(ap, ap);
    }
    let bp = p - t.b;
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return dot(bp, bp);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let q = ap - ab * (d1 / (d1 - d3));
        return dot(q, q);
    }
    let cp = p - t.c;
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return dot(cp, cp);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let q = ap - ac * (d2 / (d2 - d6));
        return dot(q, q);
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        let q = bp - (t.c - t.b) * w;
        return dot(q, q);
    }
    let sum = va + vb + vc;
    if sum <= 0.0 {
        // A degenerate triangle: the nearest of its corners.
        return min(dot(ap, ap), min(dot(bp, bp), dot(cp, cp)));
    }
    let q = ap - ab * (vb / sum) - ac * (vc / sum);
    return dot(q, q);
}
