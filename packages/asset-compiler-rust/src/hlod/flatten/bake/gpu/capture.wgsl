// A shell's texel per invocation, read through the views of the sources (`capture.rs`): the view
// facing the shell's normal most squarely among those that see the texel's point — its normal at
// least a tenth turned towards the view, the point within the view's frame and nothing of the
// shell between it and the view's near plane —; there the view's image sampled bilinearly at the
// point, each of its four pixels what the view draws along that pixel's ray (`view_pixel`): the
// base colour, the shading normal on the unit cube, roughness, metallic, specular and emission,
// each as the view's buffers keep it (`kept`). A point no view sees is a hole. The views are never
// drawn whole: a pixel is read only where a texel samples it, with the value a full view would
// hold there.

// A view: its eye, its axes — `x` the direction it looks along, `y` its image's right, `z` its
// image's up —, its near plane's distance and the half side of its image on that plane.
struct View {
    origin: vec3f,
    near: f32,
    x: vec3f,
    half_side: f32,
    y: vec3f,
    z: vec3f,
}

fn view_of(k: u32) -> View {
    let at = materials[2].z + k * VIEW_RECORDS;
    let o = f4(at);
    let x = f4(at + 1u);
    return View(o.xyz, o.w, x.xyz, x.w, f4(at + 2u).xyz, f4(at + 3u).xyz);
}

// The views' count, their images' side in pixels, and the step a visibility ray starts off the
// shell by (the head's first record).
fn view_count() -> u32 {
    return materials[0].y;
}

fn image_side() -> f32 {
    return f32(materials[0].z);
}

fn shell_offset() -> f32 {
    return bitcast<f32>(materials[0].w);
}

// Whether a view draws a translucent source as it is seen through, or a tile's texel is laid over
// what lies behind it (`../seen.rs`), and how far past a layer a ray goes on (the head's fourth
// record).
fn seen_through() -> bool {
    return materials[3].x != 0u;
}

fn layer_gap() -> f32 {
    return bitcast<f32>(materials[3].y);
}

// The least turn of the shell's normal towards a view, as the cosine between that normal and the
// view's direction: a view it faces less squarely never reads it.
const FACING: f32 = -0.1;
// The farthest a view's ray reaches.
const FAR: f32 = 3.0e38;

// What a view's pixel holds: base colour, shading normal on the unit cube, roughness and metallic,
// emission and specular.
struct Pixel {
    colour: vec3f,
    normal: vec3f,
    rough_metal: vec2f,
    emission: vec3f,
    specular: f32,
}

// The largest finite half-precision number: an emission past it is kept at it.
const HALF_MAX: f32 = 65504.0;

// The value on the unit interval a buffer of `steps` steps keeps of `x`: the nearest step.
fn stepped(x: f32, steps: f32) -> f32 {
    return floor(clamp(x, 0.0, 1.0) * steps + 0.5) / steps;
}

// Pixel `p` as a view's buffers keep it, and read back: the base colour in eight-bit sRGB, the
// normal at ten bits a channel on the unit cube, read back made unit, roughness, metallic and
// specular at eight bits, the emission — the scene colour of a view drawing nothing but it — at
// half precision.
fn kept(p: Pixel) -> Pixel {
    let c = p.colour;
    let colour = vec3f(decode(true, 0u, srgb_byte(c.x)), decode(true, 0u, srgb_byte(c.y)),
        decode(true, 0u, srgb_byte(c.z)));
    let n = p.normal;
    let stored = vec3f(stepped(n.x, 1023.0), stepped(n.y, 1023.0), stepped(n.z, 1023.0));
    let normal = normalized_or(stored * 2.0 - 1.0, vec3f(0.0)) * 0.5 + 0.5;
    let rough_metal = vec2f(stepped(p.rough_metal.x, 255.0), stepped(p.rough_metal.y, 255.0));
    let e = min(p.emission, vec3f(HALF_MAX));
    let rg = unpack2x16float(pack2x16float(e.xy));
    let b = unpack2x16float(pack2x16float(vec2f(e.z, 0.0))).x;
    return Pixel(colour, normal, rough_metal, vec3f(rg, b), stepped(p.specular, 255.0));
}

// Pixel `(px, py)` of view `v`: what the view draws along the ray from its eye through the
// pixel's centre, past the near plane, each surface's properties filtered over the pixel's
// footprint there: the first surface the ray meets, a face met from behind showing its other side;
// where a translucent one is seen through (`seen_through`), the layers it meets composed front to
// back until an opaque one (`../seen.rs`'s `Layers`) — each channel but the normal summed at the
// share each layer covers of what the layers before it left (`Shade::covers`), the last layer
// standing for what lies behind where nothing opaque does, the normal the first's —, as the
// view's buffers keep it (`kept`); zero where the ray meets nothing, as the view's image is
// cleared.
fn view_pixel(v: View, px: i32, py: i32) -> Pixel {
    let side = image_side();
    let u = (f32(px) + 0.5) / side * 2.0 - 1.0;
    let w = (f32(py) + 0.5) / side * 2.0 - 1.0;
    let on_near = v.origin + v.x * v.near + v.y * (u * v.half_side) - v.z * (w * v.half_side);
    let offset = on_near - v.origin;
    let reach = length(offset);
    let ray = offset / reach;
    var out = Pixel(vec3f(0.0), vec3f(0.0), vec2f(0.0), vec3f(0.0), 0.0);
    var last = Shade(vec3f(0.0), vec3f(0.0), vec2f(0.0), 1.0, vec3f(0.0), 0.0, 1.0);
    var left = 1.0;
    var past = 0.0;
    var met = false;
    for (var layer = 0u; layer < LAYERS && left > 0.0; layer = layer + 1u) {
        let hit = first_hit(sources_tree(), on_near, ray, past, FAR, false);
        if !hit.found {
            break;
        }
        met = true;
        // A pixel's sides on the near plane, grown with the distance to the hit.
        let step = 2.0 * v.half_side / side * (1.0 + hit.t / reach);
        let steps = triangle_steps(hit.slot, ray, v.y * step, v.z * step);
        let s = shade(hit.slot, hit.at, steps);
        if layer == 0u {
            var normal = s.normal;
            let tri = edges(hit.slot);
            if dot(cross(tri.e0, tri.e1), ray) > 0.0 {
                normal = -normal;
            }
            out.normal = normal * 0.5 + 0.5;
        }
        let share = left * s.covers;
        out.colour = out.colour + s.colour * share;
        out.rough_metal = out.rough_metal + s.rough_metal * share;
        out.emission = out.emission + s.emission * share;
        out.specular = out.specular + s.specular * share;
        left = left - share;
        last = s;
        past = hit.t + layer_gap();
    }
    if !met {
        return out;
    }
    // What the layers left, nothing opaque behind them: the last one met.
    out.colour = out.colour + last.colour * left;
    out.rough_metal = out.rough_metal + last.rough_metal * left;
    out.emission = out.emission + last.emission * left;
    out.specular = out.specular + last.specular * left;
    return kept(out);
}

// Whether nothing of the shell lies on the way from its point `p` to `q`, a point of a view's
// near plane: the ray from `p` to `q`, started `shell_offset` along it, meets no shell triangle
// before `q`.
fn unblocked(p: vec3f, q: vec3f) -> bool {
    let to = q - p;
    let distance = length(to);
    let ray = to / distance;
    return !first_hit(shell_tree(), p + ray * shell_offset(), ray, 0.0, distance, true).found;
}

@compute @workgroup_size(WORKGROUP)
fn capture(@builtin(global_invocation_id) id: vec3u) {
    if id.x >= params.count {
        return;
    }
    let i = params.first + id.x;
    let x = texel_of(i);
    let p = x.p;
    // The view facing the normal most squarely, a later view winning a tie, and where the point
    // falls on its image, pixels from its top left.
    var chosen = NONE;
    var facing = 1.0;
    var at = vec2f(0.0);
    for (var k = 0u; k < view_count(); k = k + 1u) {
        let v = view_of(k);
        let d = dot(v.x, x.n);
        if d > FACING || d > facing {
            continue;
        }
        // Where the line from the eye to the point crosses the near plane.
        let toward = normalize(p - v.origin);
        let along = dot(toward, v.x);
        if abs(along) <= 1e-8 {
            continue;
        }
        let t = v.near / along;
        if t < 0.0 {
            continue;
        }
        let q = v.origin + toward * t;
        let on_plane = q - (v.origin + v.x * v.near);
        let u = dot(on_plane, v.y) / v.half_side;
        let w = -dot(on_plane, v.z) / v.half_side;
        if abs(u) >= 1.0 || abs(w) >= 1.0 || !unblocked(p, q) {
            continue;
        }
        chosen = k;
        facing = d;
        at = vec2f(u * 0.5 + 0.5, w * 0.5 + 0.5) * image_side();
    }
    // A point no view sees: a hole, its normal the unit cube's `(0, 0, 1)` read back.
    var sum = Pixel(vec3f(0.0), vec3f(0.0, 0.0, 1.0), vec2f(0.0), vec3f(0.0), 0.0);
    if chosen != NONE {
        // The four pixels around the point, clamped to the image, and their weights.
        let v = view_of(chosen);
        let last = i32(image_side()) - 1;
        let corner = floor(at - 0.5);
        let a = at - 0.5 - corner;
        let x0 = max(i32(corner.x), 0);
        let y0 = max(i32(corner.y), 0);
        let x1 = min(i32(corner.x) + 1, last);
        let y1 = min(i32(corner.y) + 1, last);
        var pixels = array<Pixel, 4>(view_pixel(v, x0, y0), view_pixel(v, x0, y1),
            view_pixel(v, x1, y0), view_pixel(v, x1, y1));
        var weight = vec4f((1.0 - a.x) * (1.0 - a.y), (1.0 - a.x) * a.y, a.x * (1.0 - a.y),
            a.x * a.y);
        sum = Pixel(vec3f(0.0), vec3f(0.0), vec2f(0.0), vec3f(0.0), 0.0);
        for (var k = 0u; k < 4u; k = k + 1u) {
            sum.colour = sum.colour + pixels[k].colour * weight[k];
            sum.normal = sum.normal + pixels[k].normal * weight[k];
            sum.rough_metal = sum.rough_metal + pixels[k].rough_metal * weight[k];
            sum.emission = sum.emission + pixels[k].emission * weight[k];
            sum.specular = sum.specular + pixels[k].specular * weight[k];
        }
    }
    let normal = normalized_or((sum.normal - 0.5) * 2.0, vec3f(0.0));
    let read = Shade(sum.colour, normal, sum.rough_metal, 1.0, sum.emission, sum.specular, 1.0);
    let words = texel_words(read, x.n, x.frame);
    results[i] = vec4u(words.x, words.y, words.z | u32(chosen != NONE), words.w);
}
