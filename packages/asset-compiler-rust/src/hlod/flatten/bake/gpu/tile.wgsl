// A merged entry's texel per invocation (`tiles.rs`): the entry's source triangle at the texel's
// centre — the item's triangle slot and its second and third weights there — read as the entry's
// images bake it, by the one program a capture reads its sources with (`shade`): each texture
// filtered over the footprint one texel carries onto the triangle (`Laid`). It writes the texel's
// words (`tiles.rs`'s `Tile`): the base colour with its alpha, the normal in the frame the engine
// rebuilds from the entry's texture coordinates, the metal-roughness bytes, the occlusion, the
// anisotropy and the emission. A translucent texel of an entry seen through is its own layer laid
// over what the ray from it inward along its normal meets among the sources, front to back until
// an opaque surface (`seen_behind`, `../seen.rs`), its alpha then one.

// What a tile bakes beside what every texel reads, one of the `MAP_` bits of the head's last word.
fn bakes(map: u32) -> bool {
    return (materials[3].w & map) != 0u;
}

// A source triangle's place in its entry's image (`layout::LAID_RECORDS`): the barycentric steps of
// its footprint across one texel along `x` then `y`, and the deltas of its second and third
// corners' coordinates in the image from its first's.
struct Laid {
    steps: Footprint,
    d1: vec2f,
    d2: vec2f,
}

fn laid_of(t: u32) -> Laid {
    let at = materials[2].w + t * LAID_RECORDS;
    let steps = f4(at);
    let deltas = f4(at + 1u);
    return Laid(Footprint(steps.xy, steps.zw), deltas.xy, deltas.zw);
}

// The tangent-space value whose bend of `n` over the frame `frame` gives `goal`, unit: the frame
// is the engine's, rebuilt for a triangle without tangents from its texture coordinates
// (`cotangent`), and the value the normal map of the merged mesh holds.
fn tangent_space(goal: vec3f, n: vec3f, frame: mat2x3f) -> vec3f {
    let t = frame[0];
    let b = frame[1];
    let z = dot(goal, n);
    let plane = goal - n * z;
    let tt = dot(t, t);
    let tb = dot(t, b);
    let bb = dot(b, b);
    let rt = dot(plane, t);
    let rb = dot(plane, b);
    let det = tt * bb - tb * tb;
    var xy = vec2f(0.0);
    if abs(det) > 1e-20 {
        xy = vec2f((bb * rt - tb * rb) / det, (tt * rb - tb * rt) / det);
    }
    return normalized_or(vec3f(xy.x, -xy.y, z), vec3f(0.0, 0.0, 1.0));
}

// A value on `[-1, 1]` as the unit interval's byte, the way a normal map holds a direction.
fn signed_byte(x: f32) -> u32 {
    return unit_byte(x * 0.5 + 0.5);
}

// The occlusion of surface `s` at `at` of `t`, glTF's: one where the surface has no map, else the
// map's red brought towards one by the strength, `1 + strength · (red − 1)`.
fn occlusion_of(t: u32, at: vec2f, s: u32, steps: Footprint) -> f32 {
    let map = materials[s + SURFACE_EXTRA].x;
    if map == NONE {
        return 1.0;
    }
    let strengths = bitcast<vec4f>(materials[s + SURFACE_STRENGTHS]);
    let r = read_uv(t, at, s, 5u, steps);
    let red = filtered(map, wraps(s, 5u), r.uv, r.across).x;
    return clamp(1.0 + strengths.x * (red - 1.0), 0.0, 1.0);
}

// The anisotropy of surface `s` at `at` of `t`, `KHR_materials_anisotropy`'s: the unit direction
// in the tangent plane — the map's red and green on `[-1, 1]`, or the tangent where the surface
// has no map, turned by the rotation, counter-clockwise — and the strength on `[0, 1]`, the
// surface's times the map's blue.
fn anisotropy_of(t: u32, at: vec2f, s: u32, steps: Footprint) -> vec3f {
    let strengths = bitcast<vec4f>(materials[s + SURFACE_STRENGTHS]);
    let map = materials[s + SURFACE_EXTRA].y;
    var strength = strengths.y;
    var direction = vec2f(1.0, 0.0);
    if map != NONE {
        let r = read_uv(t, at, s, 6u, steps);
        let m = filtered(map, wraps(s, 6u), r.uv, r.across);
        strength = strength * m.z;
        direction = m.xy * 2.0 - 1.0;
    }
    let reach = length(direction);
    if reach > 1e-9 {
        direction = direction / reach;
    } else {
        direction = vec2f(1.0, 0.0);
    }
    let turn = vec2f(sin(strengths.z), cos(strengths.z));
    direction = vec2f(direction.x * turn.y - direction.y * turn.x,
        direction.x * turn.x + direction.y * turn.y);
    return vec3f(direction, clamp(strength, 0.0, 1.0));
}

// The base image's alpha byte at a texel of surface `s`, `alpha` its base colour's alpha there: the
// alpha itself where the image holds the material's opacity and the surface draws blended, or
// holds its mask and the surface is cut without blending; one otherwise, and where the texel is
// composed over what lies behind it, which is opaque.
fn coverage_byte(s: u32, alpha: f32, composed: bool) -> u32 {
    let cut = bitcast<vec4f>(materials[s + 2u]);
    let blended = cut.w != 0.0;
    let masked = cut.z != 0.0 && !blended;
    if !composed && ((bakes(MAP_BLEND) && blended) || (bakes(MAP_MASK) && masked)) {
        return unit_byte(alpha);
    }
    return 255u;
}

// The base colour and the roughness and metallic of a translucent texel composed over what lies
// behind it.
struct Seen {
    colour: vec3f,
    rough_metal: vec2f,
}

// `front`, a translucent texel's own layer at `origin` on its surface, laid over what lies behind
// it along `ray`, the texel's sides on its surface `across_a` and `across_b`: each surface the ray
// stops at past the one before by the layer gap, read over the footprint carried along the ray onto
// it, composed front to back — each channel summed at the share each layer covers of what the
// layers before it left — until an opaque surface or `LAYERS` layers, the last layer met standing
// for what lies behind where nothing opaque does (`../seen.rs`).
fn seen_behind(front: Shade, origin: vec3f, ray: vec3f) -> Seen {
    var colour = front.colour * front.covers;
    var rough_metal = front.rough_metal * front.covers;
    var left = 1.0 - front.covers;
    var last = front;
    var past = layer_gap();
    for (var layer = 1u; layer < LAYERS && left > 0.0; layer = layer + 1u) {
        let hit = first_hit(sources_tree(), origin, ray, past, FAR, false);
        if !hit.found {
            break;
        }
        let s = shade(hit.slot, hit.at, triangle_steps(hit.slot, ray, across_a, across_b));
        let share = left * s.covers;
        colour = colour + s.colour * share;
        rough_metal = rough_metal + s.rough_metal * share;
        left = left - share;
        last = s;
        past = hit.t + layer_gap();
    }
    return Seen(colour + last.colour * left, rough_metal + last.rough_metal * left);
}

@compute @workgroup_size(WORKGROUP)
fn tile(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= params.count {
        return;
    }
    let i = params.first + id.x;
    let item = texels[i];
    let t = item.y;
    let at = vec2f(bitcast<f32>(item.z), bitcast<f32>(item.w));
    let laid = laid_of(t);
    let s = surface_of(t);
    let tri = edges(t);
    let n = vertex_normal(t, at);
    let own = shade(t, at, laid.steps);
    // The texel's own layer, over what lies behind it where the entry is seen through and the
    // layer does not cover it all.
    var colour = own.colour;
    var rough_metal = own.rough_metal;
    var composed = false;
    if seen_through() && own.covers < 1.0 {
        across_a = tri.e0 * laid.steps.a.x + tri.e1 * laid.steps.a.y;
        across_b = tri.e0 * laid.steps.b.x + tri.e1 * laid.steps.b.y;
        let seen = seen_behind(own, tri.a + tri.e0 * at.x + tri.e1 * at.y, -n);
        colour = seen.colour;
        rough_metal = seen.rough_metal;
        composed = true;
    }
    let alpha = coverage_byte(s, own.alpha, composed);
    let base_word = pack4xU8(vec4u(srgb_byte(colour.x), srgb_byte(colour.y), srgb_byte(colour.z),
        alpha));
    // The texel's own normal: the vertex normal bent by the normal map, turned to the vertex
    // normal's side, written in the frame the engine rebuilds from the entry's coordinates.
    var bent = own.normal;
    if dot(bent, n) < 0.0 {
        bent = -bent;
    }
    let frame = cotangent(n, tri.e0, tri.e1, laid.d1, laid.d2);
    let m = tangent_space(normalized_or(bent, n), n, frame) * 0.5 + 0.5;
    let normal_word = pack4xU8(vec4u(unit_byte(m.x), unit_byte(m.y), unit_byte(m.z), 255u));
    let metal_rough_word = pack4xU8(vec4u(unit_byte(own.specular), unit_byte(rough_metal.x),
        unit_byte(rough_metal.y), 255u));
    var occlusion_word = 0u;
    if bakes(MAP_OCCLUSION) {
        let occlusion = unit_byte(occlusion_of(t, at, s, laid.steps));
        occlusion_word = pack4xU8(vec4u(occlusion, 0u, 0u, 255u));
    }
    var anisotropy_word = 0u;
    if bakes(MAP_ANISOTROPY) {
        let a = anisotropy_of(t, at, s, laid.steps);
        anisotropy_word = pack4xU8(vec4u(signed_byte(a.x), signed_byte(a.y), unit_byte(a.z),
            255u));
    }
    let e = own.emission;
    results[2u * i] = vec4u(base_word, normal_word, metal_rough_word, occlusion_word);
    results[2u * i + 1u] = vec4u(anisotropy_word, bitcast<u32>(e.x), bitcast<u32>(e.y),
        bitcast<u32>(e.z));
}
