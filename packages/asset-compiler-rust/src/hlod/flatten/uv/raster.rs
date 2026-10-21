//! The atlas's occupancy, one sample per texel and a gutter of four texels: a texel is interior
//! where the triangle nearest
//! its centre covers it — sampled there — or lies within a texel's diagonal — sampled at the
//! triangle's nearest point, nudged inside —, a gutter texel within four diagonals — a copy of the
//! interior texel under that nearest point —, empty past them. Then what the images do with it:
//! the infill of the interior texels whose sample found nothing from the valid samples around
//! them, marching inward from the holes' rims (`infill`).
//! The infill, the images it fills and the dilation outward from what holds a value (`dilate`)
//! live in `fill`.
use rayon::prelude::*;
use trillion3d_math::geometry::triangle::barycentric_weights;
use trillion3d_math::vector::vec2::{barycentric, double_area};
use trillion3d_math::vector::vecn::{dot, length, lerp, sub, weighted_sum};
mod fill;
pub(crate) use fill::{dilate, infill, Image, Role, INFILL_HOLE_BYTES};

/// The gutter, in texels: wide enough that bilinear filtering and the first mip levels at a
/// chart's edge read the chart's own colour, not the empty atlas.
const GUTTER: f64 = 4.0;
/// The nudge of a border sample into its triangle, in the unit square
/// (ten times a single-precision zero tolerance of `1e-6`): enough that the sample falls inside
/// the triangle it was taken for, not on its edge.
const NUDGE: f64 = 10.0 * 1e-6;

/// The occupancy of a texel, one `u32` each: empty, interior with a valid sample, interior whose
/// sample found nothing — a hole —, or any other value, a gutter texel copying the texel at that
/// rank (a rank below `size² ≤ 2²⁶`).
pub(crate) const EMPTY: u32 = u32::MAX;
pub(crate) const HOLE: u32 = u32::MAX - 1;
pub(crate) const SAMPLED: u32 = u32::MAX - 2;

/// The interior texel a gutter texel `code` copies, `None` for any other texel.
pub(crate) fn gutter_source(code: u32) -> Option<usize> {
    (code < SAMPLED).then_some(code as usize)
}

/// The barycentric weights of `p` in the 2D triangle `[a, b, c]`; `None` when it has no area.
fn weights(p: [f64; 2], [a, b, c]: [[f64; 2]; 3]) -> Option<[f64; 3]> {
    let area = double_area(a, b, c);
    (area.abs() >= 1e-300).then(|| {
        let [v, w] = barycentric(a, b, c, p, area);
        barycentric_weights(v, w)
    })
}

/// The weights of the point of `[a, b, c]` nearest `p`, and its distance.
fn nearest(p: [f64; 2], tri: [[f64; 2]; 3]) -> ([f64; 3], f64) {
    if let Some(w) = weights(p, tri).filter(|w| w.iter().all(|&x| x >= 0.0)) {
        return (w, 0.0);
    }
    let mut best = ([1.0, 0.0, 0.0], f64::MAX);
    for k in 0..3 {
        let (a, b) = (tri[k], tri[(k + 1) % 3]);
        let d = sub(b, a);
        let l = dot(d, d);
        let t = if l > 0.0 {
            (dot(sub(p, a), d) / l).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let gap = length(sub(p, lerp(a, b, t)));
        if gap < best.1 {
            let mut w = [0.0; 3];
            w[k] = 1.0 - t;
            w[(k + 1) % 3] = t;
            best = (w, gap);
        }
    }
    best
}

/// Each texel of a `size` square atlas classified, `corners` the triangles' corners in texels;
/// each interior texel handed to `sample(row, x, triangle, weights)` with its row's own output
/// `rows[y]`, and marked `SAMPLED` — the bake marks a `HOLE` once it knows its sample met nothing.
pub(crate) fn rasterize<R: Send>(
    size: usize,
    corners: &[[f64; 2]],
    rows: Vec<R>,
    sample: &(dyn Fn(&mut R, usize, usize, [f64; 3]) + Sync),
) -> Vec<u32> {
    let count = corners.len() / 3;
    let diagonal = std::f64::consts::SQRT_2;
    let grow = GUTTER * diagonal;
    let span = |low: f64, high: f64| {
        let from = (low - grow).floor().max(0.0) as usize;
        let to = ((high + grow).ceil().max(0.0) as usize).min(size);
        from..to
    };
    let extent = |tri: &[[f64; 2]], axis: usize| {
        let values = tri.iter().map(|p| p[axis]);
        let low = values.clone().fold(f64::MAX, f64::min);
        (low, values.fold(f64::MIN, f64::max))
    };
    // Each row's triangles, their boxes grown by the gutter.
    let mut lists: Vec<Vec<u32>> = vec![Vec::new(); size];
    for t in 0..count {
        let (low, high) = extent(&corners[t * 3..t * 3 + 3], 1);
        for list in &mut lists[span(low, high)] {
            list.push(t as u32);
        }
    }
    let clamp = |x: f64| (x.floor().max(0.0) as usize).min(size - 1);
    let triangle = |t: usize| [0, 1, 2].map(|k| corners[t * 3 + k]);
    (lists.into_par_iter().zip(rows).enumerate())
        .flat_map_iter(|(y, (tris, mut row))| {
            // Per texel, the nearest triangle within the gutter: its distance, infinite where
            // none lies within it, its rank and the weights of its nearest point.
            let mut gaps = vec![f64::INFINITY; size];
            let mut ranks = vec![0u32; size];
            let mut nearest_weights = vec![[0.0f64; 3]; size];
            let centre_y = y as f64 + 0.5;
            for &t in &tris {
                let tri = triangle(t as usize);
                let (low, high) = extent(&tri, 0);
                for x in span(low, high) {
                    let (w, gap) = nearest([x as f64 + 0.5, centre_y], tri);
                    if gap <= grow && gap < gaps[x] {
                        gaps[x] = gap;
                        ranks[x] = t;
                        nearest_weights[x] = w;
                    }
                }
            }
            let mut interior = |x: usize, t: usize, w: [f64; 3]| {
                sample(&mut row, x, t, w);
                SAMPLED
            };
            (0..size)
                .map(|x| {
                    let (gap, t) = (gaps[x], ranks[x] as usize);
                    if gap == f64::INFINITY {
                        return EMPTY;
                    }
                    let tri = triangle(t);
                    let p = [x as f64 + 0.5, centre_y];
                    let w = nearest_weights[x];
                    if gap == 0.0 {
                        return interior(x, t, w);
                    }
                    let q = weighted_sum(tri, w);
                    if gap < diagonal {
                        let nudge = NUDGE * size as f64 / gap;
                        let inside = [0, 1].map(|a| q[a] + (q[a] - p[a]) * nudge);
                        interior(x, t, weights(inside, tri).unwrap_or([1.0, 0.0, 0.0]))
                    } else {
                        (clamp(q[1]) * size + clamp(q[0])) as u32
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect()
}
