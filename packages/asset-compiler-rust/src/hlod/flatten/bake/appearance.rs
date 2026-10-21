//! The tone the bake read against the tone the atlas holds: the mean colour of the base image's
//! texels (`tone`) — the sampled ones before the holes are filled, then every interior one —, and
//! the gap a job measures per layer (`tone_gap`).

/// The mean linear colour of the base image's texels whose occupancy is one of `kept`, summed in
/// texel order; black over no texel.
pub(crate) fn tone(base: &[u8], occupancy: &[u32], kept: &[u32]) -> [f64; 3] {
    let decode = crate::texture::srgb_table();
    let (mut sum, mut count) = ([0.0f64; 3], 0.0f64);
    for (at, _) in (occupancy.iter().enumerate()).filter(|&(_, &code)| kept.contains(&code)) {
        for c in 0..3 {
            sum[c] += f64::from(decode[base[at * 4 + c] as usize]);
        }
        count += 1.0;
    }
    if count == 0.0 {
        return [0.0; 3];
    }
    sum.map(|x| x / count)
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
