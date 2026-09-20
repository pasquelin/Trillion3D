//! Fitting of one 4 × 4 block to a segment of RGBA space: two endpoints and, per
//! texel, the rank of the nearest point of a weight ladder. BC7 mode 6 and the
//! ASTC block written here both describe a block that way — what differs is the
//! ladder and how the endpoints are quantised, which each codec applies on top.
//!
//! The segment starts on the principal axis of the sixteen texels — the direction
//! that carries most of their variance —, then alternates twice between assigning
//! each texel its nearest rung and re-solving both endpoints by least squares for
//! those rungs. No search over partitions or modes: one segment, one solve.

/// One texel per entry, in reading order, channels R, G, B, A as bytes.
pub type Texels = [[f32; 4]; 16];

/// Endpoints in byte units, clamped to the byte range; the codec quantises them
/// to its own precision, then assigns the rungs once more on what decodes.
pub type Endpoints = ([f32; 4], [f32; 4]);

/// Reads block `(bx, by)` of a `width` × `height` RGBA8 image, repeating the last
/// column and row where the image stops before the block does: the padding
/// texels the GPU never samples cost nothing to the fit when they copy an edge.
pub fn block_texels(rgba: &[u8], width: u32, height: u32, bx: u32, by: u32) -> Texels {
    let mut texels = [[0.0f32; 4]; 16];
    for (index, texel) in texels.iter_mut().enumerate() {
        let x = (bx * 4 + index as u32 % 4).min(width - 1) as usize;
        let y = (by * 4 + index as u32 / 4).min(height - 1) as usize;
        let at = (y * width as usize + x) * 4;
        for channel in 0..4 {
            texel[channel] = f32::from(rgba[at + channel]);
        }
    }
    texels
}

fn add(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    std::array::from_fn(|i| a[i] + b[i])
}
fn sub(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    std::array::from_fn(|i| a[i] - b[i])
}
fn scale(a: [f32; 4], s: f32) -> [f32; 4] {
    std::array::from_fn(|i| a[i] * s)
}
fn dot(a: [f32; 4], b: [f32; 4]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Principal axis of the texels around `mean`: eight power iterations on their
/// covariance, enough for a 4 × 4 matrix whose first eigenvalue dominates — and
/// when none does, the block is nearly constant and any axis serves it.
fn principal_axis(texels: &Texels, mean: [f32; 4]) -> [f32; 4] {
    let mut covariance = [[0.0f32; 4]; 4];
    for texel in texels {
        let d = sub(*texel, mean);
        for (row, line) in covariance.iter_mut().enumerate() {
            for (column, cell) in line.iter_mut().enumerate() {
                *cell += d[row] * d[column];
            }
        }
    }
    let mut axis = [1.0f32, 1.0, 1.0, 0.5];
    for _ in 0..8 {
        let next: [f32; 4] = std::array::from_fn(|row| dot(covariance[row], axis));
        let length = dot(next, next).sqrt();
        if length < 1e-6 {
            break;
        }
        axis = scale(next, 1.0 / length);
    }
    axis
}

/// Rung nearest to `t` on the ladder, `t` being the texel's position on the
/// segment with 0 at `e0` and 1 at `e1`. Both ladders climb within half a rung of
/// the uniform one, so the rung the uniform ladder names and its two neighbours
/// always hold the nearest — three distances instead of sixteen.
fn nearest_rung(ladder: &[f32], t: f32) -> u8 {
    let last = ladder.len() - 1;
    let guess = (t.clamp(0.0, 1.0) * last as f32).round() as usize;
    let mut best = guess;
    let mut error = (ladder[guess] - t).abs();
    for rank in [guess.saturating_sub(1), (guess + 1).min(last)] {
        let gap = (ladder[rank] - t).abs();
        if gap < error {
            error = gap;
            best = rank;
        }
    }
    best as u8
}

/// Assigns every texel its rung for the segment `e0 → e1`.
pub fn assign(texels: &Texels, ladder: &[f32], e0: [f32; 4], e1: [f32; 4]) -> [u8; 16] {
    let axis = sub(e1, e0);
    let length = dot(axis, axis);
    let mut rung = [0u8; 16];
    if length < 1e-6 {
        return rung;
    }
    for (index, texel) in texels.iter().enumerate() {
        rung[index] = nearest_rung(ladder, dot(sub(*texel, e0), axis) / length);
    }
    rung
}

/// Least-squares endpoints for fixed rungs: the pair that minimises the summed
/// squared distance between each texel and its point on the segment. A
/// degenerate system — every texel on the same rung — keeps the endpoints given.
fn solve(
    texels: &Texels,
    ladder: &[f32],
    rung: &[u8; 16],
    e0: [f32; 4],
    e1: [f32; 4],
) -> ([f32; 4], [f32; 4]) {
    let (mut a, mut b, mut c) = (0.0f32, 0.0f32, 0.0f32);
    let (mut x, mut y) = ([0.0f32; 4], [0.0f32; 4]);
    for (texel, &rank) in texels.iter().zip(rung) {
        let w = ladder[rank as usize];
        let v = 1.0 - w;
        a += v * v;
        b += v * w;
        c += w * w;
        x = add(x, scale(*texel, v));
        y = add(y, scale(*texel, w));
    }
    let det = a * c - b * b;
    if det.abs() < 1e-6 {
        return (e0, e1);
    }
    let inverse = 1.0 / det;
    (
        scale(sub(scale(x, c), scale(y, b)), inverse),
        scale(sub(scale(y, a), scale(x, b)), inverse),
    )
}

/// Fits the block: principal-axis extremes, then three rounds of assign and solve.
pub fn fit(texels: &Texels, ladder: &[f32]) -> Endpoints {
    let mean = scale(
        texels.iter().fold([0.0; 4], |acc, t| add(acc, *t)),
        1.0 / 16.0,
    );
    let axis = principal_axis(texels, mean);
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    for texel in texels {
        let t = dot(sub(*texel, mean), axis);
        lo = lo.min(t);
        hi = hi.max(t);
    }
    let mut e0 = add(mean, scale(axis, lo));
    let mut e1 = add(mean, scale(axis, hi));
    for _ in 0..3 {
        let rung = assign(texels, ladder, e0, e1);
        (e0, e1) = solve(texels, ladder, &rung, e0, e1);
    }
    let clamp = |e: [f32; 4]| e.map(|v| v.clamp(0.0, 255.0));
    (clamp(e0), clamp(e1))
}
