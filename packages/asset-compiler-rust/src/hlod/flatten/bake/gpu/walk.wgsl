// The walks of the trees a capture reads (`capture.wgsl`) — the sources' and the shell's —: the
// first hit of a ray, the same whatever order the walk meets the triangles in; and the footprint
// carried onto the triangle a ray hits.

// A tree on the device: its nodes' first record and its leaf triangles' first corner record, the
// triangles in leaf order.
struct Tree {
    nodes: u32,
    corners: u32,
}

// The tree over the sources, and the one over the shell (the head's third record).
fn sources_tree() -> Tree {
    return Tree(bases().y, bases().z);
}

fn shell_tree() -> Tree {
    let at = materials[2];
    return Tree(at.x, at.y);
}

// A triangle's first corner, and its two edges from it.
struct Edges {
    a: vec3f,
    e0: vec3f,
    e1: vec3f,
}

// Triangle `t` of the corners from record `corners`.
fn edges_of(corners: u32, t: u32) -> Edges {
    let at = corners + t * CORNER_RECORDS;
    let a = f4(at).xyz;
    return Edges(a, f4(at + 1u).xyz - a, f4(at + 2u).xyz - a);
}

// Source triangle `t`.
fn edges(t: u32) -> Edges {
    return edges_of(bases().z, t);
}

// How far along the ray from `origin` it enters box `node` of `tree` from `past` on, `past` when
// the ray lies in it there; negative when the ray misses it or leaves it before `past`.
fn box_entry(tree: Tree, node: u32, origin: vec3f, inv_dir: vec3f, past: f32) -> f32 {
    let at = tree.nodes + node * NODE_RECORDS;
    let to_low = (f4(at).xyz - origin) * inv_dir;
    let to_high = (f4(at + 1u).xyz - origin) * inv_dir;
    let lows = min(to_low, to_high);
    let highs = max(to_low, to_high);
    let enter = max(max(lows.x, lows.y), lows.z);
    let leave = min(min(highs.x, highs.y), highs.z);
    if enter > leave || leave < past {
        return -1.0;
    }
    return max(enter, past);
}

struct Hit {
    found: bool,
    t: f32,
    slot: u32,
    at: vec2f,
}

// Where the ray meets triangle `slot` of the corners from record `corners`, either face, for
// `low < t < high`.
fn ray_triangle(corners: u32, slot: u32, origin: vec3f, ray: vec3f, low: f32, high: f32) -> Hit {
    let miss = Hit(false, 0.0, slot, vec2f(0.0));
    let tri = edges_of(corners, slot);
    let e0 = tri.e0;
    let e1 = tri.e1;
    let p = cross(ray, e1);
    let det = dot(e0, p);
    if abs(det) < 1e-12 {
        return miss;
    }
    let inv = 1.0 / det;
    let offset = origin - tri.a;
    let u = dot(offset, p) * inv;
    if u < 0.0 || u > 1.0 {
        return miss;
    }
    let q = cross(offset, e0);
    let v = dot(ray, q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return miss;
    }
    let t = dot(e1, q) * inv;
    if t <= low || t >= high {
        return miss;
    }
    return Hit(true, t, slot, vec2f(u, v));
}

// Whether a ray along `ray` reading the sources stops at triangle `slot` at `at`: a surface a view
// draws (`drawn`) on the face it meets — its front, or its back where it draws both faces; a
// back face a view culls lets the ray through.
fn stops(slot: u32, at: vec2f, ray: vec3f) -> bool {
    let tri = edges(slot);
    let front = dot(cross(tri.e0, tri.e1), ray) < 0.0;
    return (front || double_sided(slot)) && drawn(slot, at);
}

// The first hit of the ray from `origin` along `ray` for `past < t < limit` on `tree`: on the
// sources, the nearest one the ray stops at (`stops`), a tie to the lower slot; with `blocker`, on
// the shell, whichever triangle the walk meets first — it only asks whether one lies there. The
// stack holds every node waiting: the tree is no deeper than its bound (`layout::MAX_DEPTH`,
// checked when it is packed).
fn first_hit(tree: Tree, origin: vec3f, ray: vec3f, past: f32, limit: f32, blocker: bool) -> Hit {
    let inv_dir = 1.0 / select(ray, vec3f(1e-20), abs(ray) < vec3f(1e-20));
    var best = Hit(false, limit, 0u, vec2f(0.0));
    let root = box_entry(tree, 0u, origin, inv_dir, past);
    if root < 0.0 || root >= limit {
        return best;
    }
    var stack: array<vec2u, STACK>;
    stack[0] = vec2u(bitcast<u32>(root), 0u);
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        let enter = bitcast<f32>(stack[depth].x);
        if enter > best.t {
            continue;
        }
        let at = tree.nodes + stack[depth].y * NODE_RECORDS;
        let kids = scene[at + 2u];
        if kids.x == NONE {
            let span = scene[at + 3u];
            for (var slot = span.x; slot < span.x + span.y; slot = slot + 1u) {
                // Closed at the best's distance: a tie may still win on its slot.
                var high = best.t;
                if best.found {
                    high = bitcast<f32>(bitcast<u32>(best.t) + 1u);
                }
                let h = ray_triangle(tree.corners, slot, origin, ray, past, high);
                if !h.found {
                    continue;
                }
                if blocker {
                    return h;
                }
                let better = !best.found || h.t < best.t || slot < best.slot;
                if better && stops(slot, h.at, ray) {
                    best = h;
                }
            }
            continue;
        }
        // The nearer children entered first: pushed last.
        var near_of = array<f32, CHILDREN>();
        var kid_of = array<u32, CHILDREN>();
        var count = 0u;
        for (var k = 0u; k < CHILDREN; k = k + 1u) {
            let kid = kids[k];
            if kid == NONE {
                break;
            }
            let d = box_entry(tree, kid, origin, inv_dir, past);
            if d >= 0.0 && d <= best.t {
                var slot = count;
                while slot > 0u && near_of[slot - 1u] > d {
                    near_of[slot] = near_of[slot - 1u];
                    kid_of[slot] = kid_of[slot - 1u];
                    slot = slot - 1u;
                }
                near_of[slot] = d;
                kid_of[slot] = kid;
                count = count + 1u;
            }
        }
        for (var k = count; k > 0u; k = k - 1u) {
            stack[depth] = vec2u(bitcast<u32>(near_of[k - 1u]), kid_of[k - 1u]);
            depth = depth + 1u;
        }
    }
    return best;
}

// The barycentric steps of the footprint's sides `side_a`, `side_b` carried along `ray` onto `t`.
fn triangle_steps(t: u32, ray: vec3f, side_a: vec3f, side_b: vec3f) -> Footprint {
    let tri = edges(t);
    let e0 = tri.e0;
    let e1 = tri.e1;
    let normal = cross(e0, e1);
    let g00 = dot(e0, e0);
    let g01 = dot(e0, e1);
    let g11 = dot(e1, e1);
    let gram = g00 * g11 - g01 * g01;
    let facing = dot(normal, ray);
    if abs(gram) < 1e-30 || abs(facing) < 1e-30 {
        return Footprint(vec2f(0.0), vec2f(0.0));
    }
    var found = array<vec2f, 2>();
    var sides = array<vec3f, 2>(side_a, side_b);
    for (var k = 0u; k < 2u; k = k + 1u) {
        let onto = sides[k] - ray * (dot(normal, sides[k]) / facing);
        let r0 = dot(e0, onto);
        let r1 = dot(e1, onto);
        found[k] = vec2f((g11 * r0 - g01 * r1) / gram, (g00 * r1 - g01 * r0) / gram);
    }
    return Footprint(found[0], found[1]);
}
