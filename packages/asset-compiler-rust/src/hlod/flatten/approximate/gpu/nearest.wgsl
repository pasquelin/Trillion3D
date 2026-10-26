// The distance from each point to the nearest triangle nearer than the head's limit, `MISS` when
// none is (`morphology/field.rs`): nearer boxes first, a box no nearer than the best so far
// pruned. The stack holds every node waiting, with its box's squared distance.

@compute @workgroup_size(WORKGROUP)
fn nearest(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= params.count {
        return;
    }
    let at = params.first + id.x;
    let p = points[at].xyz;
    let head = scene[0];
    let limit = bitcast<f32>(head.w);
    var best = limit * limit;
    var found = false;
    if head.z == 0u {
        values[at] = result(MISS, false);
        return;
    }
    var stack: array<vec2u, STACK>;
    let root = head.x;
    stack[0] = vec2u(bitcast<u32>(box_distance2(f4(root).xyz, f4(root + 1u).xyz, p)), 0u);
    var depth = 1u;
    while depth > 0u {
        depth = depth - 1u;
        if bitcast<f32>(stack[depth].x) >= best {
            continue;
        }
        let node = head.x + stack[depth].y * BOX_NODE_RECORDS;
        let kids = scene[node + 2u];
        if kids.x == NONE {
            let span = scene[node + 3u];
            for (var slot = span.x; slot < span.x + span.y; slot = slot + 1u) {
                let record = head.y + slot * TRIANGLE_RECORDS;
                let d = triangle_distance2(triangle_at(record), p);
                if d < best {
                    best = d;
                    found = true;
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
            let record = head.x + kid * BOX_NODE_RECORDS;
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
    values[at] = result(select(MISS, sqrt(best), found), false);
}
