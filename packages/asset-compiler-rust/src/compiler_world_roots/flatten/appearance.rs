//! What the bakes read of a source (`bake::project`, `bake::own`): its material's own
//! properties, each its own channel — base colour, roughness and metallic as the material holds
//! them, a transmissive surface's too —; which surfaces a ray reads (`seen`); and the tone the bake
//! read against the tone the atlas holds, the gap a job measures per layer (`tone_gap`).
use crate::surface_trace::surface::METAL_ROUGH_SLOT;
use crate::surface_trace::Traceable;

/// Whether triangle `rank` covers its texel at weights `at`: always, but where its material cuts
/// its coverage.
fn covers(sources: &Traceable, rank: usize, at: [f64; 2]) -> bool {
    let surface = sources.surface(rank);
    surface.cut.is_none() || {
        let (uv, across) = sources.uv(rank, at, 0, [[0.0; 2]; 2]);
        surface.keeps(uv, across, sources.vertex_colour(rank, at)[3])
    }
}

/// Whether triangle `rank` lets light through (`KHR_materials_transmission`): the engine shades it
/// as a thin translucent layer, a surface a ray reads, unlike one drawn alpha-blended alone.
fn transmissive(sources: &Traceable, rank: usize) -> bool {
    sources.surface(rank).transmission > 0.0
}

/// Whether a ray seen from outside reads triangle `rank` at weights `at`: a surface that covers its
/// texel, opaque or transmissive; one drawn alpha-blended alone is passed through.
pub(super) fn seen(sources: &Traceable, rank: usize, at: [f64; 2]) -> bool {
    (transmissive(sources, rank) || !sources.surface(rank).blend) && covers(sources, rank, at)
}

/// Linear base colour of triangle `t` at weights `at`, its footprint's steps `steps`: the
/// material's colour tinted by the vertex colour.
pub(super) fn base_colour(
    sources: &Traceable,
    t: usize,
    at: [f64; 2],
    steps: [[f64; 2]; 2],
) -> [f64; 3] {
    let (uv, across) = sources.uv(t, at, 0, steps);
    let tint = sources.vertex_colour(t, at);
    let colour = sources.surface(t).colour(uv, across);
    [0, 1, 2].map(|c| colour[c] * tint[c])
}

/// Roughness and metallic of triangle `t` at weights `at`: the factors, times the
/// metal-roughness map where the material has one.
pub(super) fn rough_metal(
    sources: &Traceable,
    t: usize,
    at: [f64; 2],
    steps: [[f64; 2]; 2],
) -> [f64; 2] {
    let surface = sources.surface(t);
    if surface.metal_rough.is_none() {
        return surface.rough_metal;
    }
    let (uv, across) = sources.uv(t, at, METAL_ROUGH_SLOT, steps);
    surface.rough_metal(uv, across)
}

/// One row of an atlas's tally: linear colour summed over its sampled texels, and their count.
pub(super) type Tally = [f64; 4];

/// `values` added to `tally`, field by field.
fn add(tally: &mut Tally, values: Tally) {
    for (sum, value) in tally.iter_mut().zip(values) {
        *sum += value;
    }
}

/// The texel's mean colour added to `tally`.
pub(super) fn count(tally: &mut Tally, colour: [f64; 3]) {
    add(tally, [colour[0], colour[1], colour[2], 1.0]);
}

/// The rows' tallies summed in row order: the mean linear colour read, black over no texel.
pub(super) fn read_tone(tallies: &[Tally]) -> [f64; 3] {
    let mut total = [0.0; 4];
    tallies.iter().for_each(|&row| add(&mut total, row));
    if total[3] == 0.0 {
        return [0.0; 3];
    }
    [0, 1, 2].map(|k| total[k] / total[3])
}

/// The gap between the tone the bake read and the tone the atlas holds, `[read, held]` mean
/// linear colours: the difference of their luminances (Rec. 709 weights), held minus read, and
/// of their hues, degrees, within `[0, 180]` (0 when either is grey).
pub(crate) fn tone_gap([read, held]: [[f64; 3]; 2]) -> [f64; 2] {
    let luminance = |c: [f64; 3]| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let hue = |[r, g, b]: [f64; 3]| {
        let (max, min) = (r.max(g).max(b), r.min(g).min(b));
        let chroma = max - min;
        (chroma > 1e-6).then(|| {
            let h = if max == r {
                ((g - b) / chroma).rem_euclid(6.0)
            } else if max == g {
                (b - r) / chroma + 2.0
            } else {
                (r - g) / chroma + 4.0
            };
            60.0 * h
        })
    };
    let turn = match (hue(read), hue(held)) {
        (Some(a), Some(b)) => {
            let d = (a - b).abs() % 360.0;
            d.min(360.0 - d)
        }
        _ => 0.0,
    };
    [luminance(held) - luminance(read), turn]
}
