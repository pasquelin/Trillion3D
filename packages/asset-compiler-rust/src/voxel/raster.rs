//! The voxels a triangle overlaps, on the grid of side `side` from the object origin: the columns
//! along the axis its normal leans on most, each from its plane's span over the column, every voxel
//! kept by the separating-axis test (Akenine-Möller). A voxel the triangle only touches is kept, so
//! a surface lying on a voxel face leaves no hole; the rays then give it to one side (`sample.rs`).
use crate::trace::tracer::{vertex, World};
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_math::vector::vec3::{cross, dominant_axis};
use trillion3d_math::vector::vecn::{dot, scale, sub};
use trillion3d_page_codec::hash::WordMap;

/// A voxel: its corner nearest the origin over the side.
pub(crate) type Cell = [i32; 3];

/// Slack of the spans, in voxels, so a corner on a face reaches the voxels on both sides.
const SLACK: f64 = 1e-7;

/// Calls `visit` with each voxel of side `side` the triangle `corners` overlaps.
pub(crate) fn cells(corners: [[f64; 3]; 3], side: f64, visit: impl FnMut(Cell)) {
    cells_within(corners, side, None, visit);
}

/// `cells`, kept within `[0, count)` on each axis when `count` is given: a triangle reaching far
/// past a grid walks only the grid's columns.
pub(crate) fn cells_within(
    corners: [[f64; 3]; 3],
    side: f64,
    count: Option<Cell>,
    mut visit: impl FnMut(Cell),
) {
    let t = corners.map(|c| scale(c, 1.0 / side));
    // A corner not finite overlaps no voxel.
    if !t.iter().flatten().all(|x| x.is_finite()) {
        return;
    }
    // Floored in floats, then clamped, so a far corner never wraps an `i32`.
    let (floor_low, floor_high) = match count {
        Some(n) => ([0.0; 3], n.map(|n| f64::from(n) - 1.0)),
        None => ([f64::from(i32::MIN); 3], [f64::from(i32::MAX); 3]),
    };
    let low: Cell = std::array::from_fn(|k| {
        let x = (t[0][k].min(t[1][k]).min(t[2][k]) - SLACK).floor();
        x.max(floor_low[k]) as i32
    });
    let high: Cell = std::array::from_fn(|k| {
        let x = (t[0][k].max(t[1][k]).max(t[2][k]) + SLACK).floor();
        x.min(floor_high[k]) as i32
    });
    if (0..3).any(|k| low[k] > high[k]) {
        return;
    }
    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    let d = dominant_axis(n);
    let (u, v) = ((d + 1) % 3, (d + 2) % 3);
    let offset = dot(n, t[0]);
    // Rows along `v`, columns along `u` within a row, then along `d`: the order the voxels are
    // found in, which is their rank (`RayBank::set`).
    for cv in low[v]..=high[v] {
        for cu in low[u]..=high[u] {
            // The plane's span along `d` over the column's square, when the plane is not along it.
            let (from, to) = if n[d] != 0.0 {
                let at = |a: i32, b: i32| (offset - n[u] * a as f64 - n[v] * b as f64) / n[d];
                let span = [
                    at(cu, cv),
                    at(cu + 1, cv),
                    at(cu, cv + 1),
                    at(cu + 1, cv + 1),
                ];
                let lo = span.iter().fold(f64::INFINITY, |m, &x| m.min(x)) - SLACK;
                let hi = span.iter().fold(f64::NEG_INFINITY, |m, &x| m.max(x)) + SLACK;
                (
                    low[d].max(lo.floor() as i32),
                    high[d].min(hi.floor() as i32),
                )
            } else {
                (low[d], high[d])
            };
            for cd in from..=to {
                let mut cell = [0; 3];
                (cell[u], cell[v], cell[d]) = (cu, cv, cd);
                if overlaps(t, cell) {
                    visit(cell);
                }
            }
        }
    }
}

/// Whether the triangle `t`, in voxels, overlaps voxel `cell`, touching counted: no axis among the
/// box's three, the triangle's normal and the nine crossings of an edge with a box axis separates
/// them.
fn overlaps(t: [[f64; 3]; 3], cell: Cell) -> bool {
    let centre = cell.map(|c| c as f64 + 0.5);
    let t = t.map(|c| sub(c, centre));
    let half = 0.5 + SLACK;
    let separates = |axis: [f64; 3]| {
        let p = t.map(|c| dot(c, axis));
        let reach = half * (axis[0].abs() + axis[1].abs() + axis[2].abs());
        p[0].min(p[1]).min(p[2]) > reach || p[0].max(p[1]).max(p[2]) < -reach
    };
    let units = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let edges = [sub(t[1], t[0]), sub(t[2], t[1]), sub(t[0], t[2])];
    let crossed = edges.iter().flat_map(|&e| units.map(|a| cross(e, a)));
    !(units.into_iter().any(separates)
        || separates(cross(edges[0], edges[1]))
        || crossed.into_iter().any(separates))
}

/// The triangles of `triangles` — ranks in `world` — overlapping each of `candidates`, cells of side
/// `side`, by their rank, or within `reach` cells of one it overlaps: what both an HLOD cell's tiles
/// and a mesh's far groups sample each voxel against, the rays of a voxel meeting what lies `reach`
/// cells beyond its own (`VoxelSettings::reach`; none at the defaults). Each triangle is listed
/// once in a cell.
pub(super) fn binned(
    world: &World,
    (candidates, side): (&[Cell], f64),
    reach: i32,
    triangles: impl Iterator<Item = usize>,
) -> Vec<Vec<u32>> {
    let at: WordMap<Cell, usize> = (candidates.iter().enumerate())
        .map(|(i, &c)| (c, i))
        .collect();
    let mut bins: Vec<Vec<u32>> = vec![Vec::new(); candidates.len()];
    // The cells around one, looked up: past the candidates' number, each is tested instead.
    let span = i64::from(reach) * 2 + 1;
    let lookups = reach > 0 && span.saturating_pow(3) <= candidates.len() as i64;
    let around: Vec<Cell> = match lookups {
        true => (-reach..=reach)
            .flat_map(|z| {
                (-reach..=reach).flat_map(move |y| (-reach..=reach).map(move |x| [x, y, z]))
            })
            .collect(),
        false => Vec::new(),
    };
    let mut found: Vec<usize> = Vec::new();
    for t in triangles {
        let c = [0, 1, 2].map(|k| vertex(world, t, k));
        if reach == 0 {
            cells(c, side, |cell| {
                if let Some(&i) = at.get(&cell) {
                    bins[i].push(t as u32);
                }
            });
            continue;
        }
        found.clear();
        match lookups {
            true => cells(c, side, |cell| {
                let near = |o: &Cell| at.get(&[cell[0] + o[0], cell[1] + o[1], cell[2] + o[2]]);
                found.extend(around.iter().filter_map(near));
            }),
            false => found.extend(candidates_near(candidates, (c, side), reach)),
        }
        found.sort_unstable();
        found.dedup();
        for &i in &found {
            bins[i].push(t as u32);
        }
    }
    bins
}

/// The ranks of the `candidates` within `reach` cells of the cells that hold the box of the
/// triangle `corners`: a superset of the cells within `reach` of the triangle's own.
fn candidates_near(
    candidates: &[Cell],
    (corners, side): ([[f64; 3]; 3], f64),
    reach: i32,
) -> impl Iterator<Item = usize> + '_ {
    let (low, high) = aabb_of(corners);
    let cell = |v: f64| (v / side).floor() as i64;
    let (reach, low, high) = (i64::from(reach), low.map(cell), high.map(cell));
    (candidates.iter().enumerate())
        .filter(move |(_, c)| {
            (0..3).all(|k| (low[k] - reach..=high[k] + reach).contains(&i64::from(c[k])))
        })
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::super::tests::two_quads;
    use super::*;

    /// The two quads of `two_quads` as a tracer's world.
    fn quads() -> World {
        World {
            triangles: two_quads(),
            tags: vec![0; 4],
            ..World::default()
        }
    }

    // Behaviour: a triangle is listed in the cells within the rays' reach of the ones it overlaps,
    // once in each, and in none beyond; at reach 0 only in those it overlaps. Both ways of finding
    // them — looking up the cells around, or testing the candidates — agree.
    #[test]
    fn a_triangle_is_binned_within_the_reach_of_the_rays() {
        let world = quads();
        let around: Vec<Cell> = (-1..=1)
            .flat_map(|z| (-1..=1).flat_map(move |y| (-1..=1).map(move |x| [x, y, z])))
            .collect();
        let rank = |cell: Cell| around.iter().position(|&c| c == cell).unwrap();
        // 27 candidates look their neighbours up (27 cells within reach 1); one tests its box.
        for (name, cells) in [("looked up", &around[..]), ("tested", &around[13..14])] {
            let bins = |reach| binned(&world, (cells, 1.0), reach, 0..4);
            let own = cells.iter().position(|&c| c == [0, 0, 0]).unwrap();
            assert_eq!(
                bins(0)[own],
                vec![0, 1],
                "{name}: only the target overlaps it"
            );
            assert_eq!(
                bins(1)[own],
                vec![0, 1, 2, 3],
                "{name}: the occluder is in reach"
            );
        }
        let bins = binned(&world, (&around, 1.0), 1, 0..4);
        assert_eq!(
            bins[rank([1, 1, 1])],
            vec![0, 1],
            "the occluder is two cells off"
        );
    }
}
