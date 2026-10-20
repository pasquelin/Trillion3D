//! The atlas's occupancy, one sample per texel and a gutter of four texels: a texel is interior
//! where the triangle nearest
//! its centre covers it — sampled there — or lies within a texel's diagonal — sampled at the
//! triangle's nearest point, nudged inside —, a gutter texel within four diagonals — a copy of the
//! interior texel under that nearest point —, empty past them. Then what the images do with it:
//! the infill of the interior texels whose sample found nothing from the valid samples around
//! them, marching inward from the holes' rims (`infill`).
use rayon::prelude::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use trillion3d_math::triangle::barycentric_weights;
use trillion3d_math::vec2::{barycentric, double_area};
use trillion3d_math::vecn::{dot, length, lerp, sub, weighted_sum};

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
pub(super) const EMPTY: u32 = u32::MAX;
pub(super) const HOLE: u32 = u32::MAX - 1;
pub(super) const SAMPLED: u32 = u32::MAX - 2;

/// The interior texel a gutter texel `code` copies, `None` for any other texel.
pub(super) fn gutter_source(code: u32) -> Option<usize> {
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
/// each interior texel sampled by `sample(row, x, triangle, weights)` into its row's own output
/// `rows[y]`, which says whether the sample found anything (`SAMPLED`) or not (`HOLE`).
pub(super) fn rasterize<R: Send>(
    size: usize,
    corners: &[[f64; 2]],
    rows: Vec<R>,
    sample: &(dyn Fn(&mut R, usize, usize, [f64; 3]) -> bool + Sync),
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
                if sample(&mut row, x, t, w) {
                    SAMPLED
                } else {
                    HOLE
                }
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

/// The eight neighbours of texel `at` of a `size` square, row by row from the top left: a fixed
/// order, so the infill's averages are the same on every run.
fn neighbours8(size: usize, at: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((at % size) as i64, (at / size) as i64);
    const OFFSETS: [(i64, i64); 8] = [
        (-1, -1),
        (0, -1),
        (1, -1),
        (-1, 0),
        (1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
    ];
    OFFSETS.into_iter().filter_map(move |(dx, dy)| {
        let (nx, ny) = (x + dx, y + dy);
        let inside = nx >= 0 && ny >= 0 && nx < size as i64 && ny < size as i64;
        inside.then(|| ny as usize * size + nx as usize)
    })
}

/// The marching infill over the holes of `occupancy`, a `size` square: `fill(hole, neighbours)`
/// for each hole in the order it is filled — fewest missing neighbours first —, with the
/// neighbours it averages. The valid neighbours are
/// the texels whose sample found something and the holes already filled; every other texel —
/// empty, gutter — holds the missing value and never feeds a hole. A hole
/// with no valid neighbour when its turn comes is left as it is. Per hole it holds its texel, its
/// priority, its state and at most nine entries of the queue (`INFILL_HOLE_BYTES`).
pub(super) fn infill(size: usize, occupancy: &[u32], mut fill: impl FnMut(usize, &[usize])) {
    let holes: Vec<u32> = (0..occupancy.len() as u32)
        .filter(|&at| occupancy[at as usize] == HOLE)
        .collect();
    // Per texel, its rank among the holes; `NONE` for any other texel.
    const NONE: u32 = u32::MAX;
    let mut index = vec![NONE; occupancy.len()];
    for (k, &at) in holes.iter().enumerate() {
        index[at as usize] = k as u32;
    }
    let hole = |n: usize| (index[n] != NONE).then(|| index[n] as usize);
    // Per hole: filled, or its turn passed with nothing to fill it from.
    let (mut filled, mut done) = (vec![false; holes.len()], vec![false; holes.len()]);
    let valid =
        |filled: &[bool], n: usize| occupancy[n] == SAMPLED || hole(n).is_some_and(|k| filled[k]);
    let mut priority: Vec<u32> = (holes.iter())
        .map(|&at| {
            8 - neighbours8(size, at as usize)
                .filter(|&n| valid(&filled, n))
                .count() as u32
        })
        .collect();
    let mut queue: BinaryHeap<Reverse<(u32, u32)>> = (priority.iter().enumerate())
        .map(|(k, &p)| Reverse((p, k as u32)))
        .collect();
    let mut from: Vec<usize> = Vec::with_capacity(8);
    while let Some(Reverse((p, k))) = queue.pop() {
        let k = k as usize;
        if done[k] || p != priority[k] {
            continue;
        }
        done[k] = true;
        let at = holes[k] as usize;
        from.clear();
        from.extend(neighbours8(size, at).filter(|&n| valid(&filled, n)));
        if from.is_empty() {
            continue;
        }
        fill(at, &from);
        filled[k] = true;
        for n in neighbours8(size, at) {
            if let Some(m) = hole(n).filter(|&m| !filled[m] && !done[m]) {
                priority[m] -= 1;
                queue.push(Reverse((priority[m], m as u32)));
            }
        }
    }
}

/// The most bytes `infill` holds per hole: its texel and priority (8), its two states (2), and
/// nine queue entries of eight bytes (72).
pub(super) const INFILL_HOLE_BYTES: usize = 82;

/// Every empty texel of `bytes`, a `size` square RGBA image read through `decode` and written by
/// `encode`, given the mean colour of the nearest texels that are not (pull-push): the occupied
/// texels averaged into ever coarser levels, each empty texel of a level then taking its parent's
/// colour, coarse to fine. The mip levels the engine samples from far then average a chart with
/// its own colour, never with the empty atlas's black, which would darken and blur its borders.
/// Holds a third of a level of four floats a texel at half the side: about 5 bytes a texel.
pub(super) fn fill_empty(
    size: usize,
    occupancy: &[u32],
    bytes: &mut [u8],
    (decode, encode): (&[f32; 256], fn(f32) -> u8),
) {
    // Each level: its side, and per texel its mean linear colour and whether anything fed it.
    let mut levels: Vec<(usize, Vec<[f32; 4]>)> = Vec::new();
    let mut side = size;
    while side > 1 {
        let half = side.div_ceil(2);
        let mut level = vec![[0.0f32; 4]; half * half];
        let below = levels.last();
        level.par_chunks_mut(half).enumerate().for_each(|(y, row)| {
            for (x, texel) in row.iter_mut().enumerate() {
                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    let (cy, cx) = (2 * y + dy, 2 * x + dx);
                    if cy >= side || cx >= side {
                        continue;
                    }
                    let child = match below {
                        Some((_, finer)) => finer[cy * side + cx],
                        None if occupancy[cy * side + cx] == EMPTY => [0.0; 4],
                        None => {
                            let at = (cy * side + cx) * 4;
                            [0, 1, 2, 3].map(|c| {
                                if c < 3 {
                                    decode[bytes[at + c] as usize]
                                } else {
                                    1.0
                                }
                            })
                        }
                    };
                    if child[3] > 0.0 {
                        for c in 0..3 {
                            texel[c] += child[c];
                        }
                        texel[3] += 1.0;
                    }
                }
                if texel[3] > 0.0 {
                    let n = texel[3];
                    *texel = [texel[0] / n, texel[1] / n, texel[2] / n, 1.0];
                }
            }
        });
        levels.push((half, level));
        side = half;
    }
    // Coarse to fine: an empty texel takes its parent's colour.
    for k in (1..levels.len()).rev() {
        let (upper, lower) = levels.split_at_mut(k);
        let (side, finer) = &mut upper[k - 1];
        let (parent_side, coarser) = &lower[0];
        for (at, texel) in finer.iter_mut().enumerate() {
            if texel[3] == 0.0 {
                *texel = coarser[(at / *side / 2) * parent_side + (at % *side) / 2];
            }
        }
    }
    let Some((half, first)) = levels.first() else {
        return;
    };
    bytes
        .par_chunks_mut(size * 4)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..size {
                let parent = first[(y / 2) * half + x / 2];
                if occupancy[y * size + x] == EMPTY && parent[3] > 0.0 {
                    for c in 0..3 {
                        row[x * 4 + c] = encode(parent[c]);
                    }
                }
            }
        });
}
