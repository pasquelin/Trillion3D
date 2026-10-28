// The voxels of a mesh's distance field: one voxel per invocation, its value written at its own
// rank — no order between invocations reaches the values. The scene's records, the head first
// (`layout.rs`); the walks and the distance to a triangle are `approximate/gpu/tree.wgsl`'s.
// What the CPU measures voxel by voxel (`scene.rs`, `Scene::signed_distance`), in the same steps:
// the nearest triangle nearer than the trace distance, else the trace distance; then the rays.

// The ray from `origin`, `inverse` its direction's reciprocal (`reciprocal`), across the box
// `low`, `high` between `least` and `most`: where it enters, or -1 when it does not
// (`ray_span` in `ray_box.rs`). The slab test, axis by axis: the entry raised from `least` by the
// nearer side, the exit lowered from `most` by the farther; an axis the ray runs along bounds no
// `t`: it keeps the box when the origin lies between the sides, inclusive, and misses it otherwise.
fn slab(low: vec3f, high: vec3f, origin: vec3f, inverse: vec3f, least: f32, most: f32) -> f32 {
    var entry = least;
    var exit = most;
    for (var axis = 0u; axis < 3u; axis = axis + 1u) {
        if inverse[axis] == 0.0 {
            if origin[axis] < low[axis] || origin[axis] > high[axis] {
                return -1.0;
            }
            continue;
        }
        let near = (low[axis] - origin[axis]) * inverse[axis];
        let far = (high[axis] - origin[axis]) * inverse[axis];
        entry = max(entry, min(near, far));
        exit = min(exit, max(near, far));
    }
    return select(-1.0, entry, entry <= exit);
}

// The reciprocal of `ray`, axis by axis; 0 for a component nearer zero than 1e-20, which has none:
// the ray runs along that axis' slabs (`slab`).
fn reciprocal(ray: vec3f) -> vec3f {
    let along = abs(ray) < vec3f(1e-20);
    return select(1.0 / select(ray, vec3f(1.0), along), vec3f(0.0), along);
}

// The squared distance from `p` to the nearest triangle nearer than `limit2` (squared), `limit2`
// itself when none is: nearer boxes first, a box no nearer than the best so far pruned. The stack
// holds every node waiting, with its box's squared distance.
fn nearest_distance2(p: vec3f, limit2: f32) -> f32 {
    let nodes = scene[0].x;
    let triangles = scene[0].y;
    var best = limit2;
    var stack: array<vec2u, STACK>;
    stack[0] = vec2u(bitcast<u32>(box_distance2(f4(nodes).xyz, f4(nodes + 1u).xyz, p)), 0u);
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        if bitcast<f32>(stack[depth].x) >= best {
            continue;
        }
        let node = nodes + stack[depth].y * BOX_NODE_RECORDS;
        let kids = scene[node + 2u];
        if kids.x == NONE {
            let span = scene[node + 3u];
            for (var slot = span.x; slot < span.x + span.y; slot = slot + 1u) {
                let d = triangle_distance2(triangle_at(triangles + slot * TRIANGLE_RECORDS), p);
                best = min(best, d);
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
            let record = nodes + kid * BOX_NODE_RECORDS;
            let d = box_distance2(f4(record).xyz, f4(record + 1u).xyz, p);
            if d < best {
                var slot = count;
                while slot > 0u && near_of[slot - 1u] < d {
                    near_of[slot] = near_of[slot - 1u];
                    kid_of[slot] = kid_of[slot - 1u];
                    slot = slot - 1u;
                }
                near_of[slot] = d;
                kid_of[slot] = kid;
                count = count + 1u;
            }
        }
        for (var k = 0u; k < count; k = k + 1u) {
            stack[depth] = vec2u(bitcast<u32>(near_of[k]), kid_of[k]);
            depth = depth + 1u;
        }
    }
    return best;
}

// What a ray meets of one triangle: `t` when it meets it for 0 < t < 1, else -1; and whether the
// meeting is doubtful — the ray passes within `doubt` (the scene's units) of the triangle's edges,
// of its plane while running along it, or of its own ends —, where single precision may decide
// otherwise than double: such a voxel is measured again on the CPU (`gpu.rs`).
struct Meeting {
    t: f32,
    doubtful: bool,
}

// Where the ray `origin + t·ray` meets the triangle whose first record is `record`, either face,
// as the CPU's test decides it (`ray_triangle`), with the doubt of the meeting.
fn ray_triangle(record: u32, origin: vec3f, ray: vec3f, doubt: f32) -> Meeting {
    let tri = triangle_at(record);
    let e0 = tri.b - tri.a;
    let e1 = tri.c - tri.a;
    let normal = cross(e0, e1);
    let area2 = length(normal);
    let length_of_ray = length(ray);
    let perpendicular = cross(ray, e1);
    let determinant = dot(e0, perpendicular);
    let offset = origin - tri.a;
    // A ray nearly along the plane: doubtful when it runs within the doubt of it.
    if abs(determinant) < 1e-5 * length_of_ray * area2 {
        let unit = normal / max(area2, 1e-30);
        let near = min(abs(dot(offset, unit)), abs(dot(offset + ray, unit)));
        let crosses = dot(offset, unit) * dot(offset + ray, unit) <= 0.0;
        return Meeting(-1.0, crosses || near < doubt);
    }
    let inverse = 1.0 / determinant;
    let u = dot(offset, perpendicular) * inverse;
    let across = cross(offset, e0);
    let v = dot(ray, across) * inverse;
    let t = dot(e1, across) * inverse;
    let w = 1.0 - u - v;
    // The meeting point's distances to the three edges, and the ray's ends' to the plane.
    let edge = min(min(u * area2 / length(e1), v * area2 / length(e0)), w * area2 / length(tri.c - tri.b));
    let along = t * length_of_ray;
    let inside_span = along > -doubt && along < length_of_ray + doubt;
    let doubtful = inside_span
        && (abs(edge) < doubt || abs(along) < doubt || abs(length_of_ray - along) < doubt)
        && edge > -doubt;
    if abs(determinant) < 1e-12 || u < 0.0 || u > 1.0 || v < 0.0 || u + v > 1.0 || t <= 0.0
        || t >= 1.0 {
        return Meeting(-1.0, doubtful);
    }
    return Meeting(t, doubtful);
}

struct Hit {
    found: bool,
    t: f32,
    slot: u32,
    doubtful: bool,
}

// The nearest triangle `origin + t·ray` meets for 0 < t < 1, either face; of triangles met at the
// same `t`, the lowest leaf slot, so the one that wins never depends on the order the walk reaches
// them in. The nearer boxes along the ray are entered first, so the first triangle met bounds the
// rest of the walk; a box entered beyond the nearest meeting holds no nearer one, at it a tie.
fn first_hit(origin: vec3f, ray: vec3f, doubt: f32) -> Hit {
    let nodes = scene[0].x;
    let triangles = scene[0].y;
    let inverse = reciprocal(ray);
    var best = Hit(false, 1.0, 0u, false);
    var doubtful = false;
    let tie = doubt / length(ray);
    let root = slab(f4(nodes).xyz, f4(nodes + 1u).xyz, origin, inverse, 0.0, 1.0);
    if root < 0.0 {
        return best;
    }
    var stack: array<vec2u, STACK>;
    stack[0] = vec2u(bitcast<u32>(root), 0u);
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        // A box entered within the tie of the best meeting may hold one double precision puts
        // first: it is walked, and the tie test below flags the voxel.
        let reach = best.t + tie;
        if bitcast<f32>(stack[depth].x) > reach {
            continue;
        }
        let node = nodes + stack[depth].y * BOX_NODE_RECORDS;
        let kids = scene[node + 2u];
        if kids.x == NONE {
            let span = scene[node + 3u];
            for (var slot = span.x; slot < span.x + span.y; slot = slot + 1u) {
                let meeting = ray_triangle(triangles + slot * TRIANGLE_RECORDS, origin, ray, doubt);
                doubtful = doubtful || meeting.doubtful;
                let t = meeting.t;
                if t < 0.0 {
                    continue;
                }
                // Two meetings nearer each other than the doubt: which is first is doubtful.
                if best.found && slot != best.slot && abs(t - best.t) < tie {
                    doubtful = true;
                }
                if t < best.t || (best.found && t == best.t && slot < best.slot) {
                    best = Hit(true, t, slot, false);
                }
            }
            continue;
        }
        // The nearest entered first: pushed last.
        var near_of = array<f32, CHILDREN>();
        var kid_of = array<u32, CHILDREN>();
        var count = 0u;
        for (var k = 0u; k < CHILDREN; k = k + 1u) {
            let kid = kids[k];
            if kid == NONE {
                break;
            }
            let record = nodes + kid * BOX_NODE_RECORDS;
            let d = slab(f4(record).xyz, f4(record + 1u).xyz, origin, inverse, 0.0, reach);
            if d >= 0.0 {
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
    best.doubtful = doubtful;
    return best;
}

// A voxel's second word: the back faces its rays met, the echo of the point it read — its four
// floats' bits mixed, as `layout.rs:echo` mixes them —, `DOUBTFUL` when a step was doubtful.
fn second(point: vec4f, back: u32, doubtful: bool) -> u32 {
    let b = bitcast<vec4u>(point);
    let mixed = (b.x * 0x9E3779B1u) ^ (b.y * 0x85EBCA77u) ^ (b.z * 0xC2B2AE3Du) ^ (b.w * 0x27D4EB2Fu);
    let echo = (mixed ^ (mixed >> 15u)) & ECHO_MASK;
    return back | (echo << ECHO_SHIFT) | select(0u, DOUBTFUL, doubtful);
}

// A voxel's value: the signed distance to the surface held to the trace distance, and the back
// faces its rays met, `DOUBTFUL` set when a step came within the doubt of deciding otherwise. The point is the voxel's position, its mip in the fourth float.
@compute @workgroup_size(WORKGROUP)
fn field(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= params.count {
        return;
    }
    let at = params.first + id.x;
    let point = points[at];
    let p = point.xyz;
    let head = scene[0];
    let rays = scene[1];
    let mip = rays.z + u32(point.w) * MIP_RECORDS;
    let trace = f4(mip).w;
    let doubt = bitcast<f32>(rays.w);
    // The nearest triangle looked for a doubt past the trace distance: one that near it is the
    // CPU's to find or not.
    let reach = trace + doubt;
    let nearest2 = nearest_distance2(p, reach * reach);
    let nearest = sqrt(nearest2);
    let edge = abs(nearest - trace) < doubt && nearest2 < reach * reach;
    if !(nearest < trace) {
        values[at] = vec2u(bitcast<u32>(trace), second(point, 0u, edge));
        return;
    }
    let volume_low = f4(mip).xyz;
    let volume_high = f4(mip + 1u).xyz;
    var doubtful = edge;
    var back = 0u;
    for (var shot = 0u; shot < rays.x; shot = shot + 1u) {
        // The rays left, all meeting back faces, could not make enough.
        if back + rays.x - shot < head.w {
            break;
        }
        let direction = f4(rays.y + shot).xyz;
        let ray = direction * trace;
        // Every triangle lies a voxel or more inside the volume (`Grid::mip`): a ray single
        // precision keeps or skips otherwise than double crosses it within the doubt of its sides,
        // and meets nothing either way.
        if slab(volume_low, volume_high, p, reciprocal(ray), 0.0, 1.0) < 0.0 {
            continue;
        }
        let hit = first_hit(p - PULLBACK * trace * direction, ray, doubt);
        doubtful = doubtful || hit.doubtful;
        if !hit.found {
            continue;
        }
        let record = head.y + hit.slot * TRIANGLE_RECORDS;
        let tri = triangle_at(record);
        let normal = cross(tri.b - tri.a, tri.c - tri.a);
        let facing = dot(direction, normal);
        // Corners each rounded by up to a thirtieth of the doubt (`DOUBT`) turn the normal by up to
        // twice that times the edges, and the cross and the dot round by a few units of single
        // precision of the edges' product: a ray within four times that of the plane may face it
        // otherwise than double precision would.
        let one_sided = scene[record].w == 0u;
        let e0 = length(tri.b - tri.a);
        let e1 = length(tri.c - tri.a);
        let edges = e0 + e1 + length(tri.c - tri.b);
        let turned = doubt / 4.0 * edges + 2e-6 * e0 * e1;
        doubtful = doubtful || (one_sided && abs(facing) <= turned);
        if facing > 0.0 && one_sided {
            back = back + 1u;
            if back >= head.w {
                values[at] = vec2u(bitcast<u32>(-nearest), second(point, back, doubtful));
                return;
            }
        }
    }
    values[at] = vec2u(bitcast<u32>(nearest), second(point, back, doubtful));
}
