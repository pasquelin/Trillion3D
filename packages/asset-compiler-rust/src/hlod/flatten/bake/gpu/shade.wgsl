// What a source shows at a point of one of its triangles: its material's base colour, shading
// normal, roughness, metallic, specular and emission, each texture filtered over the footprint the
// texel carries onto it as an anisotropic sampler filters a texture (samples spread along the
// footprint's longer side, each trilinear between the two levels around its share of the
// footprint, bilinear in each, wrapped as its sampler wraps it, every byte decoded first: sRGB on
// a colour chain's colours); and the words a texel stores of them.

struct Footprint {
    a: vec2f,
    b: vec2f,
}

fn decode(srgb: bool, channel: u32, byte: u32) -> f32 {
    return table(select(256u, 0u, srgb && channel < 3u) + byte);
}

// The most samples a texture read takes along its footprint's longer side: the views' sampler
// anisotropy clamp (the head's fourth record, `scene::Scene::head`).
fn anisotropy() -> u32 {
    return materials[3].z;
}

// The wraps along `u` then `v` of the texture slot `slot` of surface `s` reads: the sampler's,
// `WRAP_CLAMP`, `WRAP_MIRROR` or repeat (`sources::wraps_word`).
fn wraps(s: u32, slot: u32) -> vec2u {
    let word = materials[s + 3u].w >> (4u * slot);
    return vec2u(word & 3u, (word >> 2u) & 3u);
}

// Coordinate `x` along an axis its sampler wraps by `mode`, brought within the stretch that reads
// the same texels: the texture itself when clamped to the edge, two turns when mirrored — its
// period —, one when repeated. A coordinate that is not finite reads as zero, as on the CPU, never
// outside the level.
fn folded(x: f32, mode: u32) -> f32 {
    if !is_finite(x) {
        return 0.0;
    }
    if mode == WRAP_CLAMP {
        return clamp(x, 0.0, 1.0);
    }
    if mode == WRAP_MIRROR {
        return x - 2.0 * floor(0.5 * x);
    }
    return x - floor(x);
}

// Texel `x` of a row `size` texels long as `mode` wraps it: the edge texel past either end when
// clamped, the row read back and forth when mirrored, again from its start when repeated.
fn wrap(x: i32, size: i32, mode: u32) -> i32 {
    if mode == WRAP_CLAMP {
        return clamp(x, 0, size - 1);
    }
    if mode == WRAP_MIRROR {
        let period = 2 * size;
        let turn = ((x % period) + period) % period;
        return select(turn, period - 1 - turn, turn >= size);
    }
    return ((x % size) + size) % size;
}

// Texel `(x, y)` of a level, its page `page`, wrapped along each axis by `modes`, each channel
// decoded.
fn texel(level: vec4u, page: u32, srgb: bool, modes: vec2u, x: i32, y: i32) -> vec4f {
    let w = i32(level.y);
    let row = wrap(y, i32(level.z), modes.y);
    let word = pixel(page, level.x + u32(row * w + wrap(x, w, modes.x)));
    let b = unpack4xU8(word);
    return vec4f(decode(srgb, 0u, b.x), decode(srgb, 1u, b.y), decode(srgb, 2u, b.z),
        decode(srgb, 3u, b.w));
}

fn bilinear(level: vec4u, page: u32, srgb: bool, modes: vec2u, uv: vec2f) -> vec4f {
    // The coordinates brought within the stretch that reads the same texels first (`folded`): the
    // corners then lie at most one texel outside the level, which `wrap` brings back.
    let within = vec2f(folded(uv.x, modes.x), folded(uv.y, modes.y));
    let p = within * vec2f(f32(level.y), f32(level.z)) - 0.5;
    let p0 = floor(p);
    let f = p - p0;
    let x = i32(p0.x);
    let y = i32(p0.y);
    let top =
        mix(texel(level, page, srgb, modes, x, y), texel(level, page, srgb, modes, x + 1, y), f.x);
    let bottom = mix(texel(level, page, srgb, modes, x, y + 1),
        texel(level, page, srgb, modes, x + 1, y + 1), f.x);
    return mix(top, bottom, f.y);
}

// The texture of `record` — its page and whether it reads sRGB in its third word —, wrapped by
// `modes`, at `uv` and its level of detail `lod` among the levels the page holds: bilinear in the
// level under it, blended towards the next.
fn trilinear(record: vec4u, modes: vec2u, uv: vec2f, lod: f32) -> vec4f {
    let srgb = (record.z & 1u) == 1u;
    let page = record.z >> 1u;
    let level = u32(floor(lod));
    let blend = lod - floor(lod);
    let fine = bilinear(materials[record.x + level], page, srgb, modes, uv);
    if blend == 0.0 {
        return fine;
    }
    let coarse = bilinear(materials[record.x + level + 1u], page, srgb, modes, uv);
    return fine + (coarse - fine) * blend;
}

// Texture `id`, wrapped by `modes`, at `uv` over the footprint `across`, as an anisotropic sampler
// reads it: the footprint's sides in texels, the longer `p_max` and the shorter `p_min`; their
// ratio, at most the views' anisotropy clamp (`anisotropy`), the share of the longer side each
// sample reads; as many samples as that ratio rounded up, spread evenly along the longer side, each
// at the level whose texel its share spans, no finer than the finest level the page holds, and
// their mean. A round footprint, or one that is not a number, reads one sample at `uv`.
fn filtered(id: u32, modes: vec2u, uv: vec2f, across: Footprint) -> vec4f {
    let at = materials[0].x + id * TEXTURE_RECORDS;
    let record = materials[at];
    let size = vec2f(materials[at + 1u].xy);
    let skip = f32(record.w);
    let a = length(across.a * size);
    let b = length(across.b * size);
    let longer = max(a, b);
    let shorter = min(a, b);
    let clamp_to = f32(anisotropy());
    var ratio = 1.0;
    if !is_nan(longer) && !is_nan(shorter) && longer > shorter {
        if shorter * clamp_to <= longer {
            ratio = clamp_to;
        } else {
            ratio = longer / shorter;
        }
    }
    let span = longer / ratio;
    // A NaN footprint reads the finest level kept: a NaN would clamp to no bounded level.
    let finest = select(log2(max(span, 1.0)), 0.0, is_nan(span));
    let lod = clamp(finest, skip, skip + f32(record.y - 1u)) - skip;
    let count = ceil(ratio);
    if count == 1.0 {
        return trilinear(record, modes, uv, lod);
    }
    let axis = select(across.b, across.a, a >= b);
    var sum = vec4f(0.0);
    for (var i = 0.0; i < count; i = i + 1.0) {
        let p = uv + axis * ((i + 0.5) / count - 0.5);
        sum = sum + trilinear(record, modes, p, lod);
    }
    return sum / count;
}

fn surface_of(t: u32) -> u32 {
    return SURFACES + scene[bases().z + t * CORNER_RECORDS].w * SURFACE_RECORDS;
}

fn weights(at: vec2f) -> vec3f {
    return vec3f(1.0 - at.x - at.y, at.x, at.y);
}

fn attr(t: u32, k: u32) -> vec4f {
    return f4(bases().w + t * ATTRIBUTE_RECORDS + k);
}

fn has(t: u32, k: u32) -> bool {
    return scene[bases().w + t * ATTRIBUTE_RECORDS + k].w != 0u;
}

// Corner `k`'s coordinates of set `uv_set` of triangle `t`.
fn corner_uv(t: u32, uv_set: u32, k: u32) -> vec2f {
    let i = uv_set * 3u + k;
    let pair = attr(t, 3u + i / 2u);
    return select(pair.xy, pair.zw, i % 2u == 1u);
}

struct Read {
    uv: vec2f,
    across: Footprint,
}

// The coordinate set slot `slot` of surface `s` reads: the first three slots' in the surface's
// fourth record, the emission's and the specular's in its seventeenth (`scene.rs`).
fn slot_set(s: u32, slot: u32) -> u32 {
    if slot < 3u {
        return materials[s + 3u][slot];
    }
    return materials[s + 16u][slot - 1u];
}

// The coordinates slot `slot` reads at `at` of `t` — its set, under its transform —, and their
// steps across the footprint whose barycentric steps are `steps`.
fn read_uv(t: u32, at: vec2f, s: u32, slot: u32, steps: Footprint) -> Read {
    let uv_set = min(slot_set(s, slot), 1u);
    let c0 = corner_uv(t, uv_set, 0u);
    let c1 = corner_uv(t, uv_set, 1u);
    let c2 = corner_uv(t, uv_set, 2u);
    let w = weights(at);
    let uv = c0 * w.x + c1 * w.y + c2 * w.z;
    let r0 = bitcast<vec4f>(materials[s + 5u + slot * 2u]);
    let r1 = bitcast<vec4f>(materials[s + 6u + slot * 2u]);
    let da = steps.a.x * (c1 - c0) + steps.a.y * (c2 - c0);
    let db = steps.b.x * (c1 - c0) + steps.b.y * (c2 - c0);
    let turn = mat2x2f(vec2f(r0.x, r1.x), vec2f(r0.y, r1.y));
    return Read(turn * uv + vec2f(r0.z, r1.z), Footprint(turn * da, turn * db));
}

fn vertex_colour(t: u32, at: vec2f) -> vec4f {
    if !has(t, 1u) {
        return vec4f(1.0);
    }
    let w = weights(at);
    return attr(t, 6u) * w.x + attr(t, 7u) * w.y + attr(t, 8u) * w.z;
}

fn normalized_or(v: vec3f, fallback: vec3f) -> vec3f {
    let l = length(v);
    if l > 1e-12 {
        return v / l;
    }
    return fallback;
}

// Whether surface `s` (its first record) is translucent: it transmits light, or draws
// alpha-blended (`../seen.rs`'s `translucent`).
fn translucent(s: u32) -> bool {
    let misc = bitcast<vec4f>(materials[s + 1u]);
    let cut = bitcast<vec4f>(materials[s + 2u]);
    return misc.w > 0.0 || cut.w != 0.0;
}

// Whether a view of the sources draws `t` at `at`: a translucent surface only where it is seen
// through (`seen_through`) — else, as a capture of the surfaces' properties draws it, it writes
// none of them, so what lies behind it shows —; a cut-out where its alpha reaches its cutoff; any
// other surface.
fn drawn(t: u32, at: vec2f) -> bool {
    let s = surface_of(t);
    let cut = bitcast<vec4f>(materials[s + 2u]);
    if translucent(s) && !seen_through() {
        return false;
    }
    if cut.z == 0.0 {
        return true;
    }
    let map = materials[s + 4u].x;
    var alpha = 1.0;
    if map != NONE {
        let r = read_uv(t, at, s, 0u, Footprint(vec2f(0.0), vec2f(0.0)));
        alpha = filtered(map, wraps(s, 0u), r.uv, r.across).w;
    }
    return f32(unit_byte(alpha)) / 255.0 * (cut.y * vertex_colour(t, at).w) >= cut.x;
}

// The cotangent frame about `n` of a triangle of edges `e1`, `e2` and texture deltas `d1`, `d2`:
// `T` along `u`, `B` along `v`, the longer unit — the frame the engine rebuilds for a triangle
// without tangents (sdk-browser `geometry/cluster/cotangentFrameWgsl.ts`).
fn cotangent(n: vec3f, e1: vec3f, e2: vec3f, d1: vec2f, d2: vec2f) -> mat2x3f {
    let p = cross(e2, n);
    let q = cross(n, e1);
    let t = p * d1.x + q * d2.x;
    let b = p * d1.y + q * d2.y;
    let s = 1.0 / sqrt(max(max(dot(t, t), dot(b, b)), 1e-30));
    return mat2x3f(t * s, b * s);
}

// What a surface shows at a point: its linear base colour, shading normal, roughness and metallic,
// the share of what lies behind it its own layer covers (`covers`), its linear emission and its
// specular.
struct Shade {
    colour: vec3f,
    normal: vec3f,
    rough_metal: vec2f,
    covers: f32,
    emission: vec3f,
    specular: f32,
}

// The share of a texel surface `s` covers with its own layer, the rest showing what lies behind
// it, `alpha` the base colour's alpha there (factor, texture and vertex colour) and `rough_metal`
// its own (`../seen.rs`'s `covers`): all of it for a surface neither blended nor transmitting;
// else its opacity where it draws blended, times, where it transmits, the larger of the share it
// does not transmit, its metallic and its roughness.
fn covers(s: u32, alpha: f32, rough_metal: vec2f) -> f32 {
    let misc = bitcast<vec4f>(materials[s + 1u]);
    let cut = bitcast<vec4f>(materials[s + 2u]);
    var opacity = 1.0;
    if cut.w != 0.0 {
        opacity = clamp(alpha, 0.0, 1.0);
    }
    if misc.w <= 0.0 {
        return opacity;
    }
    let lit = max(max(1.0 - misc.w, rough_metal.y), rough_metal.x);
    return opacity * clamp(lit, 0.0, 1.0);
}

// Whether source triangle `t`'s surface draws both faces (the surface's maps record's fourth word).
fn double_sided(t: u32) -> bool {
    return materials[surface_of(t) + 4u].w != 0u;
}

// What `t` shows at `at`, its footprint's barycentric steps `steps`: linear base colour tinted by
// the vertex colour, the vertex normal bent by the normal map over the triangle's cotangent frame,
// roughness and metallic, the share of what lies behind it it covers, its emission — its factor
// times its map's colour — and its specular — its input times its map's alpha.
fn shade(t: u32, at: vec2f, steps: Footprint) -> Shade {
    let s = surface_of(t);
    let maps = materials[s + 4u];
    let misc = bitcast<vec4f>(materials[s + 1u]);
    var base = bitcast<vec4f>(materials[s]) * vertex_colour(t, at);
    if maps.x != NONE {
        let r = read_uv(t, at, s, 0u, steps);
        base = base * filtered(maps.x, wraps(s, 0u), r.uv, r.across);
    }
    let colour = base.xyz;
    let tri = edges(t);
    let e1 = tri.e0;
    let e2 = tri.e1;
    let facing = normalized_or(cross(e1, e2), vec3f(0.0, 1.0, 0.0));
    var normal = facing;
    if has(t, 0u) {
        let mixed = bary(attr(t, 0u).xyz, attr(t, 1u).xyz, attr(t, 2u).xyz, weights(at));
        normal = normalized_or(mixed, facing);
    }
    if maps.z != NONE {
        let r = read_uv(t, at, s, 2u, steps);
        let tex = filtered(maps.z, wraps(s, 2u), r.uv, r.across).xyz * 2.0 - 1.0;
        let m = vec3f(tex.xy * misc.z, tex.z);
        let uv_set = min(materials[s + 3u].z, 1u);
        let base = corner_uv(t, uv_set, 0u);
        let d1 = corner_uv(t, uv_set, 1u) - base;
        let frame = cotangent(normal, e1, e2, d1, corner_uv(t, uv_set, 2u) - base);
        normal = normalized_or(frame[0] * m.x - frame[1] * m.y + normal * m.z, normal);
    }
    var rough_metal = misc.xy;
    if maps.y != NONE {
        let r = read_uv(t, at, s, 1u, steps);
        rough_metal = rough_metal * filtered(maps.y, wraps(s, 1u), r.uv, r.across).yz;
    }
    // The emission and the specular: their factors, then their maps, the slots after the normal
    // map's (`scene.rs`).
    let lit = bitcast<vec4f>(materials[s + 15u]);
    let more = materials[s + 16u];
    var emission = lit.xyz;
    if more.x != NONE {
        let r = read_uv(t, at, s, 3u, steps);
        emission = emission * filtered(more.x, wraps(s, 3u), r.uv, r.across).xyz;
    }
    var specular = lit.w;
    if more.y != NONE {
        let r = read_uv(t, at, s, 4u, steps);
        specular = specular * filtered(more.y, wraps(s, 4u), r.uv, r.across).w;
    }
    let cover = covers(s, base.w, rough_metal);
    return Shade(colour, normal, rough_metal, cover, emission, specular);
}

// Whether `x` is a NaN, tested on its bits, which no compiler folds away.
fn is_nan(x: f32) -> bool {
    let bits = bitcast<u32>(x);
    return (bits & 0x7f800000u) == 0x7f800000u && (bits & 0x007fffffu) != 0u;
}

// Whether `x` is neither a NaN nor infinite, tested on its bits.
fn is_finite(x: f32) -> bool {
    return (bitcast<u32>(x) & 0x7f800000u) != 0x7f800000u;
}

// A value on the unit interval as a byte, rounded half up; a NaN is zero, as the CPU's conversion
// makes it.
fn unit_byte(x: f32) -> u32 {
    if is_nan(x) {
        return 0u;
    }
    return u32(floor(clamp(x, 0.0, 1.0) * 255.0 + 0.5));
}

fn srgb_byte(x: f32) -> u32 {
    var v = x * 12.92;
    if x > 0.0031308 {
        v = 1.055 * pow(x, 1.0 / 2.4) - 0.055;
    }
    return unit_byte(v);
}

// A texel's words: sRGB base colour and roughness bytes; the tangent-space normal and metallic
// bytes; the specular byte in the third word's second byte, its first left to the caller, its
// upper half the emission's blue at half precision; the emission's red and green at half
// precision. The normal is the sources' unit normal against the texel's tangent, bitangent and
// normal (`frame`, `n`), each on `[-1, 1]` brought onto the unit interval.
fn texel_words(shade: Shade, n: vec3f, frame: mat2x3f) -> vec4u {
    let goal = normalized_or(shade.normal, n);
    let m = vec3f(dot(goal, frame[0]), dot(goal, frame[1]), dot(goal, n)) * 0.5 + 0.5;
    let c = shade.colour;
    let rm = shade.rough_metal;
    let base = vec4u(srgb_byte(c.x), srgb_byte(c.y), srgb_byte(c.z), unit_byte(rm.x));
    let normal = vec4u(unit_byte(m.x), unit_byte(m.y), unit_byte(m.z), unit_byte(rm.y));
    let e = shade.emission;
    let blue = pack2x16float(vec2f(e.z, 0.0));
    let extra = (unit_byte(shade.specular) << 8u) | (blue << 16u);
    return vec4u(pack4xU8(base), pack4xU8(normal), extra, pack2x16float(e.xy));
}
