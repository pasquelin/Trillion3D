//! Lot F — equivalence benches of the factored bounding boxes. The reference is
//! the loop. Reference: old version, French names.
use super::f_values::{boxes_f64, points_f32, points_f64};
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::shared_math::{bisect_centres, extend_aabb, extend_aabb_f32, merge_aabb};

const COUNT: usize = 200_000;

/// Copy of old method: `spheres.iter().map(...).collect()`.
fn empreinte_f64(boite: &([f64; 3], [f64; 3])) -> Bits {
    let mut bits = Bits::default();
    for value in boite.0.iter().chain(boite.1.iter()) {
        bits.f64(*value);
    }
    bits
}

fn empreinte_f32(boite: &([f32; 3], [f32; 3])) -> Bits {
    let mut bits = Bits::default();
    for value in boite.0.iter().chain(boite.1.iter()) {
        bits.f32(*value);
    }
    bits
}

#[allow(clippy::ptr_arg)]
fn empreinte_ordre(ordre: &Vec<usize>) -> Bits {
    let mut bits = Bits::default();
    bits.len(ordre.len());
    for id in ordre {
        bits.len(*id);
    }
    bits
}

/// F1 — the box of a point cloud, the `bounding_sphere` loop against `extend_aabb`.
pub(crate) fn row_points() -> Row {
    let points = points_f64(0x0F01_B01E, COUNT);
    compare(
        "F1 box of a point cloud (extend_aabb)",
        "shared_math.rs",
        format!("{COUNT} double points, one in seven poisoned"),
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for p in &points {
                for a in 0..3 {
                    low[a] = low[a].min(p[a]);
                    high[a] = high[a].max(p[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for p in &points {
                extend_aabb(&mut low, &mut high, *p);
            }
            (low, high)
        },
        empreinte_f64,
    )
}

/// F2 — the box of a sequence of boxes, the `build_culling_bvh` loop against `merge_aabb`.
pub(crate) fn row_boites() -> Row {
    let boxes = boxes_f64(0x0F02_B0C5, COUNT);
    compare(
        "F2 box of boxes (merge_aabb)",
        "shared_math.rs",
        format!("{COUNT} boxes, one in eleven inverted"),
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for (bmin, bmax) in &boxes {
                for a in 0..3 {
                    low[a] = low[a].min(bmin[a]);
                    high[a] = high[a].max(bmax[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for (bmin, bmax) in &boxes {
                merge_aabb(&mut low, &mut high, *bmin, *bmax);
            }
            (low, high)
        },
        empreinte_f64,
    )
}

/// F3 — the single-precision variant, that of `import/mesh.rs` and `proxy/bvh.rs`.
pub(crate) fn row_simple() -> Row {
    let points = points_f32(0x0F03_5137, COUNT);
    compare(
        "F3 single-precision box (extend_aabb_f32)",
        "shared_math.rs",
        format!("{COUNT} single points, one in seven poisoned"),
        &mut || {
            let mut low = [f32::MAX; 3];
            let mut high = [f32::MIN; 3];
            for p in &points {
                for a in 0..3 {
                    low[a] = low[a].min(p[a]);
                    high[a] = high[a].max(p[a]);
                }
            }
            (low, high)
        },
        &mut || {
            let mut low = [f32::MAX; 3];
            let mut high = [f32::MIN; 3];
            for p in &points {
                extend_aabb_f32(&mut low, &mut high, *p);
            }
            (low, high)
        },
        empreinte_f32,
    )
}

/// F4 — axis choice and median cut, the `group_clusters` loop against `bisect_centres`.
pub(crate) fn row_bisection() -> Row {
    const GROUPS: usize = 40_000;
    let centres = points_f64(0x0F04_B15E, GROUPS);
    let mut rng = Xorshift::new(0x0F04_04DE);
    let depart: Vec<usize> = {
        let mut order: Vec<usize> = (0..GROUPS).collect();
        for slot in 0..GROUPS {
            order.swap(slot, rng.below(GROUPS));
        }
        order
    };
    compare(
        "F4 median cut on the longest axis (bisect_centres)",
        "shared_math.rs",
        format!("{GROUPS} poisoned centroids, shuffled start order"),
        &mut || {
            let mut slice = depart.clone();
            let mut low = [f64::INFINITY; 3];
            let mut high = [f64::NEG_INFINITY; 3];
            for &id in slice.iter() {
                for a in 0..3 {
                    low[a] = low[a].min(centres[id][a]);
                    high[a] = high[a].max(centres[id][a]);
                }
            }
            let mut axis = 0;
            for a in 1..3 {
                if high[a] - low[a] > high[axis] - low[axis] {
                    axis = a;
                }
            }
            slice.sort_unstable_by(|&x, &y| {
                centres[x][axis]
                    .total_cmp(&centres[y][axis])
                    .then(x.cmp(&y))
            });
            slice
        },
        &mut || {
            let mut slice = depart.clone();
            bisect_centres(&mut slice, &centres);
            slice
        },
        empreinte_ordre,
    )
}
