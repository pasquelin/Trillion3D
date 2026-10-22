// Every texture a bake reads, filtered over the footprint the texel carries onto it as an
// anisotropic sampler filters a texture (samples spread along the footprint's longer side, each
// trilinear between the two levels around its share of the footprint, bilinear in each, wrapped as
// its sampler wraps it, every byte decoded first: sRGB on a colour chain's colours).

struct Footprint {
    a: vec2f,
    b: vec2f,
}

fn decode(srgb: bool, channel: u32, byte: u32) -> f32 {
    return table(select(256u, 0u, srgb && channel < 3u) + byte);
}

// The most samples a texture read takes along its footprint's longer side: the sampler's
// anisotropy clamp (the head's fourth record, `scene::Scene::head`), the views' for a capture, one
// for a tile (`tiles.rs`).
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
