// The solid's field at each point (`winding.rs`): the sum over the instances whose box holds it
// of the value there of the mesh each places — a mesh's fast winding number, a thin part's one
// within its shell or where its winding number passes `SHELL_WINDING` —, stopped at the first
// whose value reaches `SHELL_WINDING` in magnitude; every instance summed, none stopping it, when
// the scene is not read as solids. The stacks hold every node waiting: no tree is deeper than its
// bound (`layout::BINARY_DEPTH`, checked when packed).

const FOUR_PI: f32 = 12.566370614359172;
const TWO_PI: f32 = 6.283185307179586;

// The solid angle triangle `a, b, c` subtends at the origin, over 4π: Van Oosterom and Strackee's
// formula; none where both terms vanish, a point on the triangle's own edge.
fn solid_angle(a: vec3f, b: vec3f, c: vec3f) -> f32 {
    let la = length(a);
    let lb = length(b);
    let lc = length(c);
    let numerator = dot(a, cross(b, c));
    let denominator = la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb;
    if numerator == 0.0 && denominator == 0.0 {
        return 0.0;
    }
    return atan2(numerator, denominator) / TWO_PI;
}

// The node at record `at` read from afar, `d` its centre less the point and `squared` its length
// squared: its area vectors' sum against the gradient of the free-space Green's function, plus its
// second-order sum against that function's Hessian, `I / (4π r³) − 3 d dᵀ / (4π r⁵)`.
fn far_field(at: u32, d: vec3f, squared: f32) -> f32 {
    let first = f4(at + 1u);
    let m = f4(at + 2u);
    let n = f4(at + 3u);
    // The second-order sum's rows.
    let r0 = vec3f(first.w, m.x, m.y);
    let r1 = vec3f(m.z, m.w, n.x);
    let r2 = vec3f(n.y, n.z, n.w);
    let inverse = 1.0 / (FOUR_PI * squared * sqrt(squared));
    let order1 = inverse * dot(first.xyz, d);
    let across = vec3f(dot(r0, d), dot(r1, d), dot(r2, d));
    let order2 = inverse * (r0.x + r1.y + r2.z) - 3.0 * inverse / squared * dot(d, across);
    return order1 + order2;
}

// The fast winding number at `q` of the field whose root is the record `nodes`, its triangles
// from the record `triangles`: a node farther than its reach read from afar (`far_field`), a leaf's
// triangles by their exact solid angles, the root and the leaves always opened.
fn field_winding(nodes: u32, triangles: u32, q: vec3f) -> f32 {
    var total = 0.0;
    var stack: array<u32, STACK>;
    stack[0] = 0u;
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        let at = nodes + stack[depth] * FIELD_NODE_RECORDS;
        let reach = f4(at);
        let d = reach.xyz - q;
        let squared = dot(d, d);
        if squared > reach.w {
            total = total + far_field(at, d, squared);
            continue;
        }
        let first = scene[at + 4u].w;
        let second = scene[at + 5u].w;
        if (first & LEAF) != 0u {
            for (var slot = first & ~LEAF; slot < second; slot = slot + 1u) {
                let t = triangle_at(triangles + slot * TRIANGLE_RECORDS);
                total = total + solid_angle(t.a - q, t.b - q, t.c - q);
            }
            continue;
        }
        stack[depth] = first;
        stack[depth + 1u] = second;
        depth = depth + 2u;
    }
    return total;
}

// Whether `q` lies nearer than `radius` to a triangle of the field whose root is the record
// `nodes`, its triangles from the record `triangles`: the tree walked down the nodes whose box
// lies nearer than the radius.
fn in_shell(nodes: u32, triangles: u32, q: vec3f, radius: f32) -> bool {
    let limit = radius * radius;
    var stack: array<u32, STACK>;
    stack[0] = 0u;
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        let at = nodes + stack[depth] * FIELD_NODE_RECORDS;
        if box_distance2(f4(at + 4u).xyz, f4(at + 5u).xyz, q) >= limit {
            continue;
        }
        let first = scene[at + 4u].w;
        let second = scene[at + 5u].w;
        if (first & LEAF) != 0u {
            for (var slot = first & ~LEAF; slot < second; slot = slot + 1u) {
                let t = triangle_at(triangles + slot * TRIANGLE_RECORDS);
                if triangle_distance2(t, q) < limit {
                    return true;
                }
            }
            continue;
        }
        stack[depth] = first;
        stack[depth + 1u] = second;
        depth = depth + 2u;
    }
    return false;
}

// The value at `p` of the instance at record `record`: `p` brought into its mesh's space, there
// the mesh's winding number, or, a thin part's, one within its shell or where its winding number
// passes `SHELL_WINDING`, else zero.
fn instance_value(record: u32, p: vec3f) -> f32 {
    let r0 = f4(record + 2u);
    let r1 = f4(record + 3u);
    let r2 = f4(record + 4u);
    let q = vec3f(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
    let mesh = scene[scene[1].x + scene[record].w * MESH_RECORDS];
    let radius = bitcast<f32>(mesh.z);
    if radius > 0.0 {
        let inside = in_shell(mesh.x, mesh.y, q, radius)
            || field_winding(mesh.x, mesh.y, q) > SHELL_WINDING;
        return select(0.0, 1.0, inside);
    }
    return field_winding(mesh.x, mesh.y, q);
}

// The solids' sum at `p`: the box tree walked down the boxes that hold it, each instance of a leaf
// read when its own box holds it too, the walk stopped at the first instance whose value reaches
// `SHELL_WINDING` in magnitude.
fn solids_winding(p: vec3f) -> f32 {
    let head = scene[0];
    if head.y == 0u {
        return 0.0;
    }
    var total = 0.0;
    var stack: array<u32, STACK>;
    stack[0] = 0u;
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        let at = head.x + stack[depth] * BOUND_RECORDS;
        if !holds(f4(at).xyz, f4(at + 1u).xyz, p) {
            continue;
        }
        let first = scene[at].w;
        let second = scene[at + 1u].w;
        if (first & LEAF) == 0u {
            stack[depth] = first;
            stack[depth + 1u] = second;
            depth = depth + 2u;
            continue;
        }
        for (var i = first & ~LEAF; i < second; i = i + 1u) {
            let record = head.z + i * INSTANCE_RECORDS;
            if !holds(f4(record).xyz, f4(record + 1u).xyz, p) {
                continue;
            }
            let value = instance_value(record, p);
            total = total + value;
            if abs(value) >= SHELL_WINDING {
                return total;
            }
        }
    }
    return total;
}

@compute @workgroup_size(WORKGROUP)
fn winding(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= params.count {
        return;
    }
    let at = params.first + id.x;
    let p = points[at].xyz;
    if scene[1].y != 0u {
        values[at] = solids_winding(p);
        return;
    }
    // Not solids: every instance, wherever the point lies, none stopping the sum.
    let head = scene[0];
    var total = 0.0;
    for (var i = 0u; i < head.w; i = i + 1u) {
        total = total + instance_value(head.z + i * INSTANCE_RECORDS, p);
    }
    values[at] = total;
}
